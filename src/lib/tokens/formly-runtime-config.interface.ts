export interface PouchDBConfig {
  localAnswersStoreName: string;
  localFormsCatalogStoreName: string;
}

export interface FormlyBffConfig {
  apiBaseUrl: string;
  publicCatalogPath?: string;
  publicFormsPath?: string;
  publicAnswersPath?: string;
  catalogAccessToken?: string;
}

export type FormlyAuthStrategy = 'none' | 'cookie' | 'bearer' | 'hybrid';

export interface FormlyAuthAdapter {
  authStrategy?: FormlyAuthStrategy;
  requestCredentialsPolicy?: RequestCredentials;
  getAccessToken?: () => string | null | Promise<string | null>;
  getCsrfToken?: () => string | null | Promise<string | null>;
  onUnauthorized?: () => void | Promise<void>;
}

export interface FormlyRuntimeConfig {
  pouchDB?: PouchDBConfig;
  bff?: FormlyBffConfig;
  auth?: FormlyAuthAdapter;
}
