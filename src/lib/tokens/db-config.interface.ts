export interface PouchDBConfig {
  local: string;
  remote: string;
}

export interface MongoDBConfig {
  baseURL: string;
}

export interface DBConfig {
  pouchDB: PouchDBConfig;
  mongoDB: MongoDBConfig;
}
