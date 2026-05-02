import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import {
  FormCatalogItem,
  FormCatalogRefreshOptions,
  FormCatalogSourceMode,
  FormCatalogSyncState,
} from '../interfaces/form-catalog.interface';
import { ConfigService } from './config.service';

interface CatalogDoc {
  _id: string;
  _rev?: string;
  type: 'questionnaire';
  formId: string;
  title: string;
  projectId: string;
  description?: string;
  formlyFields: FormlyFieldConfig[];
  updatedAt: string;
  sourceHash: string;
}

interface FormObjectId {
  $oid?: string;
}

interface FormRecord {
  _id?: string | number | FormObjectId;
  id?: string | number | FormObjectId;
  filename?: string;
  projectId?: string;
  project_id?: string;
  publicUrl?: string;
  fields?: FormlyFieldConfig[];
  title?: string;
  description?: string;
  updatedAt?: string;
  __v?: number;
}

interface FormsResponse {
  forms?: FormRecord[];
  userForms?: FormRecord[];
  documents?: FormRecord[];
  data?: FormRecord[];
  items?: FormRecord[];
  results?: FormRecord[];
  existingForm?: FormRecord;
  document?: FormRecord;
}

@Injectable({
  providedIn: 'root',
})
export class FormCatalogService {
  private localPouchDB: any | null = null;
  private localCatalogDbName: string | null = null;
  private formsBaseUrl: string | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly syncStateSubject = new BehaviorSubject<FormCatalogSyncState>({
    status: 'idle',
    lastSyncAt: null,
    source: 'unknown',
  });

  readonly syncState$ = this.syncStateSubject.asObservable();

  constructor(
    private readonly http: HttpClient,
    private readonly configService: ConfigService,
  ) {
    const pouchDBConfig = this.configService.getPouchDBConfig();
    if (pouchDBConfig?.localFormsCatalogStoreName) {
      this.localCatalogDbName = pouchDBConfig.localFormsCatalogStoreName;
    } else {
      console.error('PouchDB local configuration not found for form catalog.');
    }

    this.formsBaseUrl = this.configService.getApiBaseUrl();
    if (!this.formsBaseUrl) {
      console.error('BFF/forms base URL is not configured for form catalog fetch.');
    }
  }

  getSyncStateSnapshot(): FormCatalogSyncState {
    return this.syncStateSubject.value;
  }

  async getById(id: string): Promise<FormCatalogItem | null> {
    if (!(await this.localCatalogDbExists())) {
      return null;
    }

    try {
      const doc = await this.withPouchRetry((localPouchDB) => localPouchDB.get(this.buildDocId(id)));
      return this.toCatalogItem(doc as CatalogDoc);
    } catch (error: any) {
      if (error?.status === 404) {
        return null;
      }
      console.error('Form catalog getById failed:', error);
      return null;
    }
  }

  async listByProject(projectId?: string): Promise<FormCatalogItem[]> {
    if (!(await this.localCatalogDbExists())) {
      return [];
    }

    try {
      const result = await this.withPouchRetry<any>((localPouchDB) => localPouchDB.allDocs({ include_docs: true }));
      const docs = (result?.rows ?? [])
        .map((row: any) => row?.doc as CatalogDoc | undefined)
        .filter((doc): doc is CatalogDoc => !!doc && doc.type === 'questionnaire');

      const filtered = projectId
        ? docs.filter((doc) => this.normalizeComparable(doc.projectId) === this.normalizeComparable(projectId))
        : docs;

      return filtered
        .map((doc) => this.toCatalogItem(doc))
        .sort((a, b) => a.title.localeCompare(b.title));
    } catch (error) {
      console.error('Form catalog listByProject failed:', error);
      return [];
    }
  }

  async fetchCatalog(options: FormCatalogRefreshOptions): Promise<FormCatalogItem[]> {
    const sourceMode = this.resolveSourceMode(options);
    return sourceMode === 'local'
      ? this.fetchCatalogFromLocal(options)
      : this.fetchCatalogFromApi(options);
  }

  async fetchCatalogFromApi(options: FormCatalogRefreshOptions): Promise<FormCatalogItem[]> {
    if (!this.formsBaseUrl) {
      throw new Error('BFF/forms base URL is not configured.');
    }

    if (!this.isBrowserOnline()) {
      const cachedItems = await this.listFromCache(options);
      if (cachedItems.length > 0) {
        this.pushSyncState({
          status: 'ready',
          lastSyncAt: this.syncStateSubject.value.lastSyncAt,
          source: 'cache',
          message: `Using cached catalog (${cachedItems.length} forms) while offline.`,
        });
        return cachedItems;
      }

      this.pushSyncState({
        status: 'error',
        lastSyncAt: this.syncStateSubject.value.lastSyncAt,
        source: 'cache',
        message: 'Offline and no cached forms available.',
      });
      throw new Error('Offline and no cached forms available.');
    }

    const accessToken = `${options.accessToken ?? ''}`.trim();
    const endpointPath = `${options.endpointPath ?? (accessToken ? this.configService.getPublicFormsPath() : this.configService.getPublicCatalogPath())}`.trim();
    const normalizedPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
    const endpoint = accessToken && options.formId
      ? `${this.formsBaseUrl}${normalizedPath}/${encodeURIComponent(options.formId)}`
      : `${this.formsBaseUrl}${normalizedPath}`;
    let params = new HttpParams();

    if (accessToken) {
      params = params.set('accessToken', accessToken);
    }

    if (options.projectId) {
      params = params.set('projectId', options.projectId);
    }

    const catalogAccessToken = this.configService.getCatalogAccessToken();
    if (!accessToken && !catalogAccessToken) {
      this.pushSyncState({
        status: 'error',
        lastSyncAt: this.syncStateSubject.value.lastSyncAt,
        source: 'remote',
        message: 'catalogAccessToken is not configured.',
      });
      throw new Error('catalogAccessToken is not configured.');
    }

    const headers = !accessToken && catalogAccessToken
      ? { Authorization: `Bearer ${catalogAccessToken}` }
      : undefined;

    this.pushSyncState({
      status: 'syncing',
      lastSyncAt: this.syncStateSubject.value.lastSyncAt,
      source: 'remote',
      message: accessToken ? 'Fetching form from signed link.' : 'Fetching public catalog.',
    });

    try {
      const response = await firstValueFrom(this.http.get<FormsResponse>(endpoint, { params, headers }));
      const items = this.extractRecords(response)
        .map((record) => this.mapFormRecord(record))
        .filter((item): item is FormCatalogItem => !!item)
        .filter((item) => this.matchesProjectFilter(item.projectId, options.projectId))
        .filter((item) => this.matchesFormIdFilter(item.id, options.formId));

      if (this.shouldPersistToCache(options)) {
        try {
          await this.upsertMany(items);
        } catch (cacheError) {
          console.error('Form catalog cache upsert failed (non-blocking):', cacheError);
        }
      }

      const nowIso = new Date().toISOString();
      this.pushSyncState({
        status: 'ready',
        lastSyncAt: nowIso,
        source: 'remote',
        message: `Catalog refreshed (${items.length} forms).`,
      });
      return items;
    } catch (error: any) {
      const cachedItems = await this.listFromCache(options);
      if (cachedItems.length > 0) {
        this.pushSyncState({
          status: 'ready',
          lastSyncAt: this.syncStateSubject.value.lastSyncAt,
          source: 'cache',
          message: `Using cached catalog (${cachedItems.length} forms).`,
        });
        return cachedItems;
      }

      this.pushSyncState({
        status: 'error',
        lastSyncAt: this.syncStateSubject.value.lastSyncAt,
        source: 'remote',
        message: error?.message ?? 'Failed to fetch forms catalog.',
      });
      throw error;
    }
  }

  async downloadCatalogForOffline(options: FormCatalogRefreshOptions): Promise<number> {
    const items = await this.fetchCatalog({
      ...options,
      persistToCache: true,
    });
    return items.length;
  }

  private async fetchCatalogFromLocal(options: FormCatalogRefreshOptions): Promise<FormCatalogItem[]> {
    const assetPath = `${options.source?.localAssetPath ?? ''}`.trim();
    if (!assetPath) {
      throw new Error('Local forms asset path is not configured.');
    }

    this.pushSyncState({
      status: 'syncing',
      lastSyncAt: this.syncStateSubject.value.lastSyncAt,
      source: 'local',
      message: 'Fetching forms catalog from local asset.',
    });

    try {
      const payload = await firstValueFrom(this.http.get<FormsResponse | FormRecord[]>(assetPath));
      const items = this.extractRecords(payload)
        .filter((record) => this.matchesProjectFilter(this.resolveProjectId(record), options.projectId))
        .filter((record) => this.matchesFormIdFilter(this.normalizeId(record._id ?? record.id), options.formId))
        .map((record) => this.mapFormRecord(record))
        .filter((item): item is FormCatalogItem => !!item)
        .sort((a, b) => a.title.localeCompare(b.title));

      if (this.shouldPersistToCache(options)) {
        try {
          await this.upsertMany(items);
        } catch (cacheError) {
          console.error('Form catalog cache upsert failed (non-blocking):', cacheError);
        }
      }

      const nowIso = new Date().toISOString();
      this.pushSyncState({
        status: 'ready',
        lastSyncAt: nowIso,
        source: 'local',
        message: `Catalog refreshed (${items.length} forms).`,
      });
      return items;
    } catch (error: any) {
      this.pushSyncState({
        status: 'error',
        lastSyncAt: this.syncStateSubject.value.lastSyncAt,
        source: 'local',
        message: error?.message ?? 'Failed to fetch local forms catalog.',
      });
      throw error;
    }
  }

  private extractRecords(payload: FormsResponse | FormRecord[] | null | undefined): FormRecord[] {
    if (!payload) {
      return [];
    }
    if (Array.isArray(payload)) {
      return payload;
    }

    const listKeys: Array<keyof FormsResponse> = ['documents', 'forms', 'userForms', 'items', 'data', 'results'];
    for (const key of listKeys) {
      const value = payload[key];
      if (Array.isArray(value)) {
        return value;
      }
    }

    const singleKeys: Array<keyof FormsResponse> = ['existingForm', 'document'];
    for (const key of singleKeys) {
      const value = payload[key];
      if (value && typeof value === 'object') {
        return [value as FormRecord];
      }
    }

    return [];
  }

  private matchesProjectFilter(value: string, projectId?: string): boolean {
    if (!projectId) {
      return true;
    }
    return this.normalizeComparable(value) === this.normalizeComparable(projectId);
  }

  private matchesFormIdFilter(value: string, formId?: string): boolean {
    if (!formId) {
      return true;
    }
    return `${value}` === `${formId}`;
  }

  private mapFormRecord(record: FormRecord): FormCatalogItem | null {
    const id = this.normalizeId(record._id ?? record.id);
    if (!id) {
      return null;
    }

    const formlyFields = this.sanitizeFormlyFields(Array.isArray(record.fields) ? record.fields : []);
    const title = `${record.title ?? record.filename ?? id}`.trim() || id;
    const description = `${record.description ?? ''}`.trim();
    const projectId = this.resolveProjectId(record);
    const updatedAt = `${record.updatedAt ?? ''}`.trim() || new Date().toISOString();
    const publicUrl = `${record.publicUrl ?? ''}`.trim() || undefined;
    const sourceHash = this.computeSourceHash({
      _id: id,
      title,
      projectId,
      description,
      fields: formlyFields,
      publicUrl: publicUrl ?? '',
      __v: record.__v,
    });

    return {
      id,
      title,
      description,
      projectId,
      formlyFields,
      updatedAt,
      sourceHash,
      publicUrl,
    };
  }

  private resolveSourceMode(options: FormCatalogRefreshOptions): FormCatalogSourceMode {
    return options.source?.mode === 'local' ? 'local' : 'api';
  }

  private pushSyncState(state: FormCatalogSyncState): void {
    this.syncStateSubject.next(state);
    console.info('[formly-form-utils][catalog-sync]', state);
  }

  private normalizeId(rawId: FormRecord['_id'] | FormRecord['id']): string {
    if (typeof rawId === 'string' || typeof rawId === 'number') {
      return `${rawId}`;
    }
    if (rawId && typeof rawId === 'object' && typeof (rawId as FormObjectId).$oid === 'string') {
      return `${(rawId as FormObjectId).$oid}`;
    }
    return '';
  }

  private resolveProjectId(record: FormRecord): string {
    return `${record.projectId ?? record.project_id ?? ''}`.trim();
  }

  private sanitizeFormlyFields(fields: FormlyFieldConfig[]): FormlyFieldConfig[] {
    return fields.map((field) => this.sanitizeFormlyField(field));
  }

  private sanitizeFormlyField(field: FormlyFieldConfig): FormlyFieldConfig {
    const copy: FormlyFieldConfig = { ...(field ?? {}) };
    copy.validators = this.sanitizeValidatorBag(copy.validators);
    copy.asyncValidators = this.sanitizeValidatorBag(copy.asyncValidators);

    if (Array.isArray(copy.fieldGroup)) {
      copy.fieldGroup = copy.fieldGroup.map((child) => this.sanitizeFormlyField(child));
    }

    if (copy.fieldArray && typeof copy.fieldArray === 'object') {
      copy.fieldArray = this.sanitizeFormlyField(copy.fieldArray as FormlyFieldConfig);
    }

    return copy;
  }

  private sanitizeValidatorBag(
    value: FormlyFieldConfig['validators'] | FormlyFieldConfig['asyncValidators'],
  ): FormlyFieldConfig['validators'] | FormlyFieldConfig['asyncValidators'] | undefined {
    if (!value || typeof value !== 'object') {
      return value;
    }

    const normalized: Record<string, unknown> = {};
    for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'validation') {
        const list = Array.isArray(candidate)
          ? candidate
            .map((item) => this.normalizeValidatorCandidate('', item))
            .filter((item) => item != null)
          : [];
        if (list.length > 0) {
          normalized['validation'] = list;
        }
        continue;
      }

      const normalizedCandidate = this.normalizeValidatorCandidate(key, candidate);
      if (normalizedCandidate == null) {
        continue;
      }
      normalized[key] = normalizedCandidate;
    }

    return Object.keys(normalized).length > 0
      ? (normalized as FormlyFieldConfig['validators'] | FormlyFieldConfig['asyncValidators'])
      : undefined;
  }

  private normalizeValidatorCandidate(name: string, candidate: unknown): unknown {
    if (candidate == null || candidate === false) {
      return undefined;
    }

    if (candidate === true) {
      return name || undefined;
    }

    const candidateType = typeof candidate;
    if (candidateType === 'string' || candidateType === 'function') {
      return candidate;
    }

    if (candidateType !== 'object') {
      return undefined;
    }

    if (Array.isArray(candidate)) {
      return candidate;
    }

    const asObject = candidate as Record<string, unknown>;
    if (asObject['name'] || asObject['expression'] || asObject['validation']) {
      return asObject;
    }

    // Some exported forms use { message: '...' } for validators.<name>.
    // Convert them to validator-name string so Formly can resolve registered validators.
    return name || undefined;
  }

  private async upsertMany(items: FormCatalogItem[]): Promise<void> {
    if (!items.length) {
      return;
    }

    await this.withPouchRetry(async (localPouchDB) => {
      const docs: CatalogDoc[] = [];
      for (const item of items) {
        const _id = this.buildDocId(item.id);
        try {
          const existing = await localPouchDB.get(_id);
          docs.push({
            ...this.toCatalogDoc(item),
            _id,
            _rev: existing?._rev,
          });
        } catch (error: any) {
          if (error?.status !== 404) {
            throw error;
          }
          docs.push({
            ...this.toCatalogDoc(item),
            _id,
          });
        }
      }
      await localPouchDB.bulkDocs(docs);
    });
  }

  private async listFromCache(options: FormCatalogRefreshOptions): Promise<FormCatalogItem[]> {
    if (!(await this.localCatalogDbExists())) {
      return [];
    }

    const fromProject = await this.listByProject(options.projectId);
    const filteredByForm = options.formId
      ? fromProject.filter((item) => this.matchesFormIdFilter(item.id, options.formId))
      : fromProject;

    return filteredByForm.sort((a, b) => a.title.localeCompare(b.title));
  }

  private async ensurePouchDB(): Promise<void> {
    if (this.localPouchDB) {
      return;
    }
    if (!this.localCatalogDbName) {
      throw new Error('PouchDB local catalog name is not configured.');
    }

    if (!this.initPromise) {
      this.initPromise = (async () => {
        const module = await import('pouchdb');
        const PouchDBConstructor = (module as any).default ?? module;
        this.localPouchDB = new PouchDBConstructor(this.localCatalogDbName);
      })();
    }
    await this.initPromise;
  }

  private async getLocalPouchDB(): Promise<any | null> {
    try {
      await this.ensurePouchDB();
      return this.localPouchDB;
    } catch (error) {
      console.error('Form catalog PouchDB initialization failed:', error);
      return null;
    }
  }

  private async withPouchRetry<T>(operation: (localPouchDB: any) => Promise<T>): Promise<T> {
    const localPouchDB = await this.getLocalPouchDB();
    if (!localPouchDB) {
      throw new Error('PouchDB not initialized.');
    }

    try {
      return await operation(localPouchDB);
    } catch (error: any) {
      if (!this.isPouchConnectionClosingError(error)) {
        throw error;
      }

      await this.resetPouchConnection();
      const retryPouchDB = await this.getLocalPouchDB();
      if (!retryPouchDB) {
        throw error;
      }
      return operation(retryPouchDB);
    }
  }

  private async resetPouchConnection(): Promise<void> {
    if (this.localPouchDB?.close && typeof this.localPouchDB.close === 'function') {
      try {
        await this.localPouchDB.close();
      } catch {
        // Ignore close errors and force re-open.
      }
    }
    this.localPouchDB = null;
    this.initPromise = null;
  }

  private isPouchConnectionClosingError(error: unknown): boolean {
    const name = `${(error as any)?.name ?? ''}`.toLowerCase();
    const message = `${(error as any)?.message ?? ''}`.toLowerCase();
    return name.includes('invalidstateerror')
      || message.includes('database connection is closing')
      || message.includes('database is closed')
      || message.includes('connection is closing');
  }

  private buildDocId(formId: string): string {
    return `questionnaire:${formId}`;
  }

  private toCatalogDoc(item: FormCatalogItem): CatalogDoc {
    return {
      _id: this.buildDocId(item.id),
      type: 'questionnaire',
      formId: item.id,
      title: item.title,
      projectId: item.projectId,
      description: item.description,
      formlyFields: item.formlyFields ?? [],
      updatedAt: item.updatedAt,
      sourceHash: item.sourceHash,
    };
  }

  private toCatalogItem(doc: CatalogDoc): FormCatalogItem {
    return {
      id: doc.formId,
      title: doc.title,
      description: doc.description,
      projectId: doc.projectId,
      formlyFields: this.sanitizeFormlyFields(Array.isArray(doc.formlyFields) ? doc.formlyFields : []),
      updatedAt: doc.updatedAt,
      sourceHash: doc.sourceHash,
    };
  }

  private normalizeComparable(value: unknown): string {
    return `${value ?? ''}`.trim().toLowerCase();
  }

  private computeSourceHash(value: unknown): string {
    const serialized = JSON.stringify(value ?? {});
    let hash = 0;
    for (let i = 0; i < serialized.length; i += 1) {
      hash = ((hash << 5) - hash) + serialized.charCodeAt(i);
      hash |= 0;
    }
    return `h${Math.abs(hash)}`;
  }

  private shouldPersistToCache(options: FormCatalogRefreshOptions): boolean {
    return options.persistToCache === true;
  }

  private async localCatalogDbExists(): Promise<boolean> {
    if (this.localPouchDB) {
      return true;
    }
    if (!this.localCatalogDbName) {
      return false;
    }
    if (typeof indexedDB === 'undefined' || typeof (indexedDB as any).databases !== 'function') {
      // If database enumeration is unavailable, preserve previous behavior.
      return true;
    }

    try {
      const databases = await (indexedDB as any).databases();
      const pouchName = `pouch_${this.localCatalogDbName}`;
      return (databases ?? []).some((db: any) => {
        const name = `${db?.name ?? ''}`;
        return name === this.localCatalogDbName || name === pouchName;
      });
    } catch {
      return true;
    }
  }

  private isBrowserOnline(): boolean {
    if (typeof navigator === 'undefined') {
      return true;
    }
    return navigator.onLine;
  }
}
