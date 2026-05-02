import { FormlyFieldConfig } from '@ngx-formly/core';

export interface FormCatalogItem {
  id: string;
  title: string;
  projectId: string;
  description?: string;
  formlyFields: FormlyFieldConfig[];
  updatedAt: string;
  sourceHash: string;
  publicUrl?: string;
}

export interface FormCatalogSyncState {
  status: 'idle' | 'syncing' | 'ready' | 'error';
  lastSyncAt: string | null;
  source?: 'remote' | 'cache' | 'local' | 'unknown';
  message?: string;
}

export interface FormCatalogRefreshOptions {
  accessToken?: string;
  persistToCache?: boolean;
  projectId?: string;
  formId?: string;
  endpointPath?: string;
  source?: FormCatalogSourceOptions;
}

export type FormCatalogSourceMode = 'api' | 'local';

export interface FormCatalogSourceOptions {
  mode?: FormCatalogSourceMode;
  localAssetPath?: string;
}
