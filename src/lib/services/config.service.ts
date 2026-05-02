import { Inject, Injectable, Optional } from '@angular/core';
import { FORMLY_AUTH_ADAPTER, FORMLY_RUNTIME_CONFIG } from '../tokens/formly-runtime-config.token';
import {
  FormlyAuthAdapter,
  FormlyBffConfig,
  FormlyRuntimeConfig,
  PouchDBConfig,
} from '../tokens/formly-runtime-config.interface';

@Injectable({
  providedIn: 'root'
})
export class ConfigService {
  private readonly runtimeConfig: Partial<FormlyRuntimeConfig>;
  private readonly authAdapter: FormlyAuthAdapter | null;

  constructor(
    @Optional() @Inject(FORMLY_RUNTIME_CONFIG) config: FormlyRuntimeConfig | null,
    @Optional() @Inject(FORMLY_AUTH_ADAPTER) authAdapter: FormlyAuthAdapter | null,
  ) {
    this.runtimeConfig = config ?? {};
    this.authAdapter = authAdapter ?? config?.auth ?? null;
  }

  getRuntimeConfig(): Partial<FormlyRuntimeConfig> {
    return this.runtimeConfig;
  }

  getPouchDBConfig(): PouchDBConfig | undefined {
    return this.runtimeConfig.pouchDB;
  }

  getBffConfig(): FormlyBffConfig | undefined {
    return this.runtimeConfig.bff;
  }

  getAuthAdapter(): FormlyAuthAdapter | null {
    return this.authAdapter;
  }

  getApiBaseUrl(): string | null {
    const apiBaseUrl = `${this.runtimeConfig.bff?.apiBaseUrl ?? ''}`.trim();
    if (!apiBaseUrl) {
      return null;
    }
    return apiBaseUrl.replace(/\/+$/, '');
  }

  getPublicCatalogPath(): string {
    const path = `${this.runtimeConfig.bff?.publicCatalogPath ?? '/formly-form/public/catalog'}`.trim();
    return path.startsWith('/') ? path : `/${path}`;
  }

  getPublicFormsPath(): string {
    const path = `${this.runtimeConfig.bff?.publicFormsPath ?? '/formly-form/public/forms'}`.trim();
    return path.startsWith('/') ? path : `/${path}`;
  }

  getPublicAnswersPath(): string {
    const path = `${this.runtimeConfig.bff?.publicAnswersPath ?? '/formly-form/public/answers'}`.trim();
    return path.startsWith('/') ? path : `/${path}`;
  }

  getCatalogAccessToken(): string {
    return `${this.runtimeConfig.bff?.catalogAccessToken ?? ''}`.trim();
  }
}
