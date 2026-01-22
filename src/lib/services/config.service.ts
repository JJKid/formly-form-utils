import { Injectable, Inject } from '@angular/core';
import { DB_CONFIG } from '../tokens/db-config.token';

@Injectable({
  providedIn: 'root'
})
export class ConfigService {
  private dbConfig: any;

  constructor(@Inject(DB_CONFIG) private config: any) {
    this.dbConfig = config || {};
  }

  getPouchDBConfig(): any {
    return this.dbConfig.pouchDB;
  }

  getMongoDBConfig(): any {
    return this.dbConfig.mongoDB;
  }
}
