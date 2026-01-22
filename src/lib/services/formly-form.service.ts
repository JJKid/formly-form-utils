import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { HttpClient, HttpParams } from '@angular/common/http';
import { FormlyForm } from '../interfaces/formly-form.interface';
import { ConfigService } from './config.service';

@Injectable({
  providedIn: 'root'
})
export class FormlyFormService {

  private mongoDbBaseUrl: string | undefined;

  constructor(
    private http: HttpClient,
    private configService: ConfigService
  ) {
    const mongoDBConfig = this.configService.getMongoDBConfig();

    if (mongoDBConfig) {
      this.mongoDbBaseUrl = mongoDBConfig.baseURL;
    } else {
      console.error('MongoDB configuration not found.');
    }
  }

  private _currentFormlyForm: Subject<FormlyForm> = new Subject<FormlyForm>();
  public currentFormlyFormObs = this._currentFormlyForm.asObservable();

  setCurrentFormlyForm(form: FormlyForm) {
    this._currentFormlyForm.next(form);
  }

  getCurrentForm(): Observable<FormlyForm> {
    return this.currentFormlyFormObs;
  }

  createFormlyForm(formlyForm: any): Observable<Object> {
    console.log("Formly form sent to endpoint", formlyForm);
    return this.http.post(`${this.mongoDbBaseUrl}/formly-form`, formlyForm);
  }

  getFormlyForms(): Observable<Object> {
    return this.http.get(`${this.mongoDbBaseUrl}/formly-form`);
  }

  getFormlyForm(id: string): Observable<FormlyForm> {
    const params = new HttpParams().set('id', id);
    return this.http.get<FormlyForm>(`${this.mongoDbBaseUrl}/formly-form`, { params });
  }

  getUserFormlyForms(userId: string): Observable<FormlyForm[]> {
    const params = new HttpParams().set('userId', userId);
    return this.http.get<FormlyForm[]>(`${this.mongoDbBaseUrl}/formly-form`, { params });
  }

  getUserFormlyFormsByEmail(userEmail: string): Observable<FormlyForm[]> {
    const params = new HttpParams().set('userEmail', userEmail);
    return this.http.get<FormlyForm[]>(`${this.mongoDbBaseUrl}/formly-form`, { params });
  }

  updateFormlyForm(id: string, formlyForm: FormlyForm): Observable<Object> {
    return this.http.put(`${this.mongoDbBaseUrl}/formly-form/${id}`, formlyForm);
  }

  deleteFormlyForm(id: string) {
    return this.http.delete<FormlyForm>(`${this.mongoDbBaseUrl}/formly-form/${id}`).subscribe();
  }
}

