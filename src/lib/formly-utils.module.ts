import { CommonModule } from '@angular/common';
import { ModuleWithProviders, NgModule } from '@angular/core';
import { FormlyRuntimeConfig } from './tokens/formly-runtime-config.interface';
import { FORMLY_AUTH_ADAPTER, FORMLY_RUNTIME_CONFIG } from './tokens/formly-runtime-config.token';

@NgModule({
  imports: [CommonModule],
  providers: [],
})
export class FormlyUtilsModule {
  static forRoot(config: FormlyRuntimeConfig): ModuleWithProviders<FormlyUtilsModule> {
    return {
      ngModule: FormlyUtilsModule,
      providers: [
        { provide: FORMLY_RUNTIME_CONFIG, useValue: config },
        { provide: FORMLY_AUTH_ADAPTER, useValue: config.auth ?? null },
      ],
    };
  }
}
