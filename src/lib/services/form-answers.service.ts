import { Injectable } from '@angular/core';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { BehaviorSubject } from 'rxjs';
import { ConfigService } from './config.service';

export interface FormAnswersSyncState {
  status: 'idle' | 'syncing' | 'paused' | 'error';
  lastEventAt: string | null;
  online?: boolean;
  message?: string;
}

interface PouchDBPutResult {
  ok: boolean;
  id: string;
  rev: string;
}

interface PouchDBAllDocsResult {
  rows?: Array<{ doc?: StoredPublicFormAnswers }>;
}

interface StoredAnswerSyncMetadata {
  accessToken?: string;
  syncStatus: 'pending' | 'synced' | 'error';
  syncedAt?: string;
  storedId?: string;
  lastError?: string;
}

/**
 * Local public-answer document stored in PouchDB.
 * It is different from the original form document fetched from the backend:
 * this entity stores the respondent payload plus local sync bookkeeping.
 */
interface StoredPublicFormAnswers extends StoredAnswerSyncMetadata {
  _id: string;
  _rev?: string;
  type: 'public-form-answer';
  formId?: string;
  formFilename: string;
  formAnswers: unknown;
  submittedAt: string;
}

interface PublicAnswerSyncItem {
  localId: string | null;
  storedId: string;
  formId: string;
  formFilename: string;
  submittedAt: string;
}

interface PublicAnswerSyncResponse {
  storedCount?: number;
  items?: PublicAnswerSyncItem[];
}

export interface PublicAnswerSubmitResult {
  localId: string;
  localRevision: string;
  delivery: 'synced' | 'stored-local' | 'sync-error';
  message: string;
  syncState: FormAnswersSyncState;
}

@Injectable({
  providedIn: 'root',
})
export class FormAnswersService {
  private localPouchDB: any | null = null;
  private initPromise: Promise<void> | null = null;
  private flushPromise: Promise<void> | null = null;
  private readonly syncStateSubject = new BehaviorSubject<FormAnswersSyncState>({
    status: 'idle',
    lastEventAt: null,
    online: this.isBrowserOnline(),
    message: 'Waiting for answer sync activity.',
  });

  readonly syncState$ = this.syncStateSubject.asObservable();

  constructor(private readonly configService: ConfigService) {
    this.bindConnectivityListeners();
    void this.ensurePouchDB().then(() => this.flushPendingAnswers()).catch((error) => {
      console.error('Form answers storage initialization failed:', error);
      this.pushSyncState({
        status: 'error',
        message: 'Answer storage could not be initialized.',
      });
    });
  }

  async addPublicFormAnswers(formFilename: string, formAnswers: unknown, options?: { accessToken?: string }): Promise<PublicAnswerSubmitResult> {
    return this.persistPublicFormAnswers({
      formFilename,
      formAnswers,
      accessToken: options?.accessToken,
    });
  }

  async addPublicFormAnswersFromFormly(
    formIdentifier: string,
    payload: unknown,
    fields: FormlyFieldConfig[] = [],
    options?: { accessToken?: string },
  ): Promise<PublicAnswerSubmitResult> {
    const normalizedPayload = this.normalizeFormlyPayload(payload, fields);
    return this.persistPublicFormAnswers({
      formId: formIdentifier,
      formFilename: formIdentifier,
      formAnswers: normalizedPayload,
      accessToken: options?.accessToken,
    });
  }

  async flushPendingAnswers(): Promise<void> {
    if (this.flushPromise) {
      return this.flushPromise;
    }

    this.flushPromise = this.doFlushPendingAnswers().finally(() => {
      this.flushPromise = null;
    });

    return this.flushPromise;
  }

  getSyncStateSnapshot(): FormAnswersSyncState {
    return this.syncStateSubject.value;
  }

  /**
   * Always persists the answer locally first and then attempts an immediate sync.
   * The returned delivery state reflects the latest local sync status after that attempt.
   */
  private async persistPublicFormAnswers(input: {
    formId?: string;
    formFilename: string;
    formAnswers: unknown;
    accessToken?: string;
  }): Promise<PublicAnswerSubmitResult> {
    const localPouchDB = await this.getLocalPouchDB();
    const document: StoredPublicFormAnswers = {
      _id: `formAnswers:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
      type: 'public-form-answer',
      formId: input.formId,
      formFilename: input.formFilename,
      formAnswers: input.formAnswers,
      submittedAt: new Date().toISOString(),
      accessToken: `${input.accessToken ?? ''}`.trim() || undefined,
      syncStatus: 'pending',
    };

    const result: PouchDBPutResult = await localPouchDB.put(document);

    this.pushSyncState({
      status: 'paused',
      message: 'Answer stored locally. Sync scheduled.',
    });

    await this.flushPendingAnswers();

    const latestDoc = await localPouchDB.get(result.id) as StoredPublicFormAnswers;
    const syncState = this.getSyncStateSnapshot();
    if (latestDoc.syncStatus === 'synced') {
      return {
        localId: result.id,
        localRevision: result.rev,
        delivery: 'synced',
        message: 'Answer stored locally and synced with the BFF.',
        syncState,
      };
    }

    if (latestDoc.syncStatus === 'error') {
      return {
        localId: result.id,
        localRevision: result.rev,
        delivery: 'sync-error',
        message: latestDoc.lastError || syncState.message || 'Answer stored locally but BFF sync failed.',
        syncState,
      };
    }

    return {
      localId: result.id,
      localRevision: result.rev,
      delivery: 'stored-local',
      message: syncState.message || 'Answer stored locally. Sync is still pending.',
      syncState,
    };
  }

  /**
   * Reads pending public answers from local PouchDB and sends them to the backend.
   * This is application-level synchronization, not native PouchDB replication.
   */
  private async doFlushPendingAnswers(): Promise<void> {
    const bffBaseUrl = this.configService.getApiBaseUrl();
    if (!bffBaseUrl) {
      this.pushSyncState({
        status: 'paused',
        message: 'No BFF configured. Answers stay local.',
      });
      return;
    }

    if (!this.isBrowserOnline()) {
      this.pushSyncState({
        status: 'paused',
        online: false,
        message: 'Offline mode. Pending answers remain local.',
      });
      return;
    }

    const localPouchDB = await this.getLocalPouchDB();
    const pendingDocs = await this.listPendingDocuments(localPouchDB);
    if (pendingDocs.length === 0) {
      this.pushSyncState({
        status: 'paused',
        message: 'No pending answers to sync.',
      });
      return;
    }

    this.pushSyncState({
      status: 'syncing',
      message: `Syncing ${pendingDocs.length} pending answers.`,
    });

    try {
      const groups = this.groupPendingDocuments(pendingDocs);
      let syncedCount = 0;

      for (const group of groups) {
        const response = await this.postPendingAnswers(bffBaseUrl, group);
        const syncedLocalIds = new Map<string, string>();
        (response.items ?? []).forEach((item) => {
          if (item?.localId) {
            syncedLocalIds.set(item.localId, item.storedId);
          }
        });

        for (const doc of group) {
          const storedId = syncedLocalIds.get(doc._id) ?? null;
          await this.markDocumentSynced(localPouchDB, doc, storedId);
        }

        syncedCount += group.length;
      }

      this.pushSyncState({
        status: 'paused',
        message: `Synced ${syncedCount} answers with the BFF.`,
      });
    } catch (error: any) {
      console.error('Public answer sync failed:', error);
      for (const doc of pendingDocs) {
        await this.markDocumentError(localPouchDB, doc, error?.message ?? 'Unknown sync error');
      }
      this.pushSyncState({
        status: 'error',
        message: error?.message ?? 'Public answer sync failed.',
      });
    }
  }

  /**
   * Sends one batch of pending answers that share the same signed form token.
   * The backend revalidates that token before persisting to CouchDB.
   */
  private async postPendingAnswers(
    bffBaseUrl: string,
    pendingDocs: StoredPublicFormAnswers[],
  ): Promise<PublicAnswerSyncResponse> {
    const accessToken = `${pendingDocs[0]?.accessToken ?? ''}`.trim();
    const endpoint = `${bffBaseUrl}${this.configService.getPublicAnswersPath()}`;
    if (!accessToken) {
      throw new Error('Public answer sync requires accessToken.');
    }

    const body: Record<string, unknown> = {
      accessToken,
      answers: pendingDocs.map((doc) => ({
        localId: doc._id,
        formId: doc.formId,
        formFilename: doc.formFilename,
        formAnswers: doc.formAnswers,
        submittedAt: doc.submittedAt,
      })),
    };


    const response = await this.fetchWithAuth(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (response.status === 401) {
      await this.handleUnauthorized();
      throw new Error('BFF rejected the answer sync as unauthorized.');
    }

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`BFF answer sync failed: ${detail || response.statusText}`);
    }

    return response.json() as Promise<PublicAnswerSyncResponse>;
  }

  private async ensurePouchDB(): Promise<void> {
    if (this.localPouchDB) {
      return;
    }

    const pouchDBConfig = this.configService.getPouchDBConfig();
    if (!pouchDBConfig?.localAnswersStoreName) {
      throw new Error('PouchDB localAnswersStoreName configuration not found.');
    }

    if (!this.initPromise) {
      this.initPromise = (async () => {
        const module = await import('pouchdb');
        const PouchDBConstructor = (module as any).default ?? module;
        this.localPouchDB = new PouchDBConstructor(pouchDBConfig.localAnswersStoreName);
      })();
    }

    await this.initPromise;
  }

  private async getLocalPouchDB(): Promise<any> {
    await this.ensurePouchDB();
    if (!this.localPouchDB) {
      throw new Error('PouchDB not initialized.');
    }
    return this.localPouchDB;
  }

  private async listPendingDocuments(localPouchDB: any): Promise<StoredPublicFormAnswers[]> {
    const result = await localPouchDB.allDocs({ include_docs: true }) as PouchDBAllDocsResult;
    return (result.rows ?? [])
      .map((row) => row.doc)
      .filter((doc): doc is StoredPublicFormAnswers => !!doc && doc.type === 'public-form-answer')
      .filter((doc) => doc.syncStatus !== 'synced');
  }

  private async markDocumentSynced(localPouchDB: any, doc: StoredPublicFormAnswers, storedId: string | null): Promise<void> {
    await localPouchDB.put({
      ...doc,
      syncStatus: 'synced',
      syncedAt: new Date().toISOString(),
      storedId: storedId ?? doc.storedId,
      lastError: undefined,
    });
  }

  private async markDocumentError(localPouchDB: any, doc: StoredPublicFormAnswers, message: string): Promise<void> {
    await localPouchDB.put({
      ...doc,
      syncStatus: 'error',
      lastError: message,
    });
  }

  private async fetchWithAuth(url: string, options: RequestInit): Promise<Response> {
    const authAdapter = this.configService.getAuthAdapter();
    const headers = new Headers(options.headers ?? {});
    const bearerToken = authAdapter?.getAccessToken ? await authAdapter.getAccessToken() : null;
    const csrfToken = authAdapter?.getCsrfToken ? await authAdapter.getCsrfToken() : null;
    const method = `${options.method ?? 'GET'}`.toUpperCase();
    const mutatingMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

    if (bearerToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${bearerToken}`);
    }
    if (csrfToken && mutatingMethod && !headers.has('X-CSRF-Token')) {
      headers.set('X-CSRF-Token', csrfToken);
    }

    return fetch(url, {
      ...options,
      headers,
      credentials: authAdapter?.requestCredentialsPolicy ?? 'include',
    });
  }

  private async handleUnauthorized(): Promise<void> {
    const authAdapter = this.configService.getAuthAdapter();
    if (authAdapter?.onUnauthorized) {
      await authAdapter.onUnauthorized();
    }
  }

  private bindConnectivityListeners(): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.addEventListener('online', () => {
      this.pushSyncState({ online: true, message: 'Network available. Sync resumed.' });
      void this.flushPendingAnswers();
    });
    window.addEventListener('offline', () => {
      this.pushSyncState({ online: false, status: 'paused', message: 'Offline mode. Answers stay local.' });
    });
  }

  private isBrowserOnline(): boolean {
    if (typeof navigator === 'undefined') {
      return true;
    }
    return navigator.onLine;
  }

  private pushSyncState(partial: Partial<FormAnswersSyncState>): void {
    const nextState = {
      ...this.syncStateSubject.value,
      ...partial,
      online: partial.online ?? this.isBrowserOnline(),
      lastEventAt: new Date().toISOString(),
    };
    this.syncStateSubject.next(nextState);
    console.info('[formly-form-utils][answers-sync]', nextState);
  }

  private groupPendingDocuments(pendingDocs: StoredPublicFormAnswers[]): StoredPublicFormAnswers[][] {
    const grouped = new Map<string, StoredPublicFormAnswers[]>();

    for (const doc of pendingDocs) {
      const key = doc.accessToken ? `token:${doc.accessToken}` : 'token:missing';
      const bucket = grouped.get(key) ?? [];
      bucket.push(doc);
      grouped.set(key, bucket);
    }

    return Array.from(grouped.values());
  }

  private normalizeFormlyPayload(
    payload: unknown,
    fields: FormlyFieldConfig[],
  ): Record<string, unknown> {
    const normalized = this.asRecord(payload);
    const prefixes = this.collectNoAnswerPrefixes(fields);

    Object.entries(normalized).forEach(([key, value]) => {
      if (value !== '') {
        return;
      }
      if (this.shouldSkipNoAnswerNormalizationKey(key)) {
        return;
      }
      if (prefixes.some((prefix) => key.startsWith(prefix))) {
        normalized[key] = 'N';
      }
    });

    return normalized;
  }

  private collectNoAnswerPrefixes(fields: FormlyFieldConfig[]): string[] {
    const prefixes: string[] = [];

    const walk = (fieldList: FormlyFieldConfig[]): void => {
      (fieldList ?? []).forEach((field) => {
        const type = `${field?.type ?? ''}`.trim().toLowerCase();
        const key = this.resolveFieldKey(field);
        if (key) {
          const isMatrixMultiple =
            type === 'matrix'
            && `${field?.props?.['matrix']?.['selectionMode'] ?? field?.props?.['selectionMode'] ?? ''}`.trim().toLowerCase() === 'multiple';
          const isMultiChoice =
            type === 'checkboxwithtext'
            || type === 'multicheckbox'
            || ((type === 'selectinline' || type === 'select') && !!field?.props?.['multiple']);
          if (isMatrixMultiple || isMultiChoice) {
            prefixes.push(`${key}_`);
          }
        }

        if (Array.isArray(field?.fieldGroup) && field.fieldGroup.length > 0) {
          walk(field.fieldGroup);
        }
      });
    };

    walk(fields ?? []);
    return prefixes;
  }

  private resolveFieldKey(field: FormlyFieldConfig): string {
    if (typeof field?.key === 'string') {
      return field.key.trim();
    }
    if (typeof field?.key === 'number') {
      return `${field.key}`;
    }
    return '';
  }

  private asRecord(payload: unknown): Record<string, unknown> {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return { ...(payload as Record<string, unknown>) };
    }
    return {};
  }

  private shouldSkipNoAnswerNormalizationKey(key: string): boolean {
    const normalizedKey = `${key ?? ''}`.toLowerCase();
    return normalizedKey.endsWith('_value')
      || normalizedKey.endsWith('_comment')
      || normalizedKey.endsWith('__othercomment')
      || normalizedKey.endsWith('__comments');
  }
}
