declare module 'pouchdb' {
  interface PouchDB {
    put(doc: any): Promise<any>;
    get(id: string): Promise<any>;
    remove(doc: any): Promise<any>;
    allDocs(params?: any): Promise<any>;
  }

  export default PouchDB;
}
