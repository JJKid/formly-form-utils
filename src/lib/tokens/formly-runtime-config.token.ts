import { InjectionToken } from '@angular/core';
import { FormlyAuthAdapter, FormlyRuntimeConfig } from './formly-runtime-config.interface';

export const FORMLY_RUNTIME_CONFIG = new InjectionToken<FormlyRuntimeConfig>('FORMLY_RUNTIME_CONFIG');
export const FORMLY_AUTH_ADAPTER = new InjectionToken<FormlyAuthAdapter | null>('FORMLY_AUTH_ADAPTER');
