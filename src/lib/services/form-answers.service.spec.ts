import { TestBed } from '@angular/core/testing';

import { FormAnswersService } from './form-answers.service';

describe('FormAnswersService', () => {
  let service: FormAnswersService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(FormAnswersService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
