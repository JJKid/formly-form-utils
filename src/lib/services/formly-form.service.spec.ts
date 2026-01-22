import { TestBed } from '@angular/core/testing';

import { FormlyFormService } from './formly-form.service';

describe('FormlyFormService', () => {
  let service: FormlyFormService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(FormlyFormService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
