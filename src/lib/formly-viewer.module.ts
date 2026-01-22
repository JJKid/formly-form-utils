import { NgModule, ModuleWithProviders } from '@angular/core';
import { ConfigService } from './services/config.service';
import { FormAnswersService } from './services/form-answers.service';
import { FormlyFormService } from './services/formly-form.service';
import { DB_CONFIG } from './tokens/db-config.token';
import { CommonModule } from '@angular/common';

@NgModule({
  imports: [
    CommonModule,
  ],
  providers: [
    ConfigService,
    FormAnswersService,
    FormlyFormService,
  ]
})
export class FormlyViewerModule {
  static forRoot(config: any): ModuleWithProviders<FormlyViewerModule> {
    return {
      ngModule: FormlyViewerModule,
      providers: [
        { provide: DB_CONFIG, useValue: config }
      ]
    };
  }
}
