import { Injectable } from '@angular/core';
import { ConfigService } from './config.service';

import PouchDB from 'pouchdb';

interface PouchDBPublicFormAnswers {
  _id: string;
  formAnswers: any;
  formFilename: string;
}

interface PouchDBPutResult {
	ok: boolean;
	id: string;
	rev: string;
}

interface PouchDBGetResult {
	_id: string;
	_rev: string;
}

interface PouchDBRemoveResult {
	ok: boolean;
	id: string;
	rev: string;
}

@Injectable({
  providedIn: 'root'
})
export class FormAnswersService {

  private data: any;
  private localPouchDB: any | null = null;
  private remoteCouchDB: string | null = null;

  constructor(private configService: ConfigService) {
    const pouchDBConfig = this.configService.getPouchDBConfig();

    if (pouchDBConfig) {
      this.localPouchDB = new PouchDB(pouchDBConfig.local);
      this.remoteCouchDB = pouchDBConfig.remote;
      console.log(`localPouchDB URL: ${pouchDBConfig.local} remoteCouchDB URL: ${pouchDBConfig.remote}`);
      this.setupSync();
    } else {
      console.error('PouchDB/CouchDB configuration not found.');
    }
  }


  private setupSync() {
    if (this.localPouchDB && this.remoteCouchDB) {
      let options = {
        live: true,
        retry: true,
      };

      this.localPouchDB.sync(this.remoteCouchDB, options)
        .on('change', function (info: any) {
          console.log('Replication change', info);
        })
        .on('paused', function (err: any) {
          console.log('Replication paused', err);
        })
        .on('active', function () {
          console.log('Replication resumed');
        })
        .on('denied', function (err: any) {
          console.error('Replication denied', err);
        })
        .on('complete', function (info: any) {
          console.log('Replication complete', info);
        })
        .on('error', function (err: any) {
          console.error('Replication error', err);
        });
    } else {
      console.error('form-answers service not properly configured.');
    }
  }

  getFormAnswers(){
    if (this.data) {
      return Promise.resolve(this.data);
    }
    return new Promise(resolve => {
      this.localPouchDB.allDocs({
        include_docs: true
      }).then((result:any) => {
        this.data = [];
        let docs = result.rows.map((row:any) => {
          this.data.push(row.doc);
        });
        resolve(this.data);
        this.localPouchDB.changes({live: true, since: 'now', include_docs: true}).on('change', (change:any) => {
          this.handleChange(change);
        });
      }).catch((error:any) => {
        console.log(error);
      });
    });
  }

  /**
   * Save the entered form answers by an user identified by email after filling them,
   * along with some current form details into PouchDB
   * @param formFilename
   * @param formAnswers
   * @param userEmail
   * @returns
   */
  addUserFormAnswers(formFilename: string, formAnswers: any, userEmail: string) {
    let pouchDbFormAnswers: any = {
      _id: "formAnswers:" + new Date().getTime(),
      formFilename: formFilename,
      formAnswers: formAnswers,
      userEmail: userEmail
    }
    var promise = this.localPouchDB.put(pouchDbFormAnswers)
      .then((result: PouchDBPutResult): string => {
        return("Saved form answers: " +  result.id + " Revision: " + result.rev);
      });

    return promise;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }


  /**
   * Save the entered form answers by a public user after filling them,
   * along with some current form details into PouchDB
   * @param formFilename
   * @param formAnswers
   * @returns
   */

  async addPublicFormAnswers(formFilename: string, formAnswers: any): Promise<string> {
    try {
      let pouchDbFormAnswers: PouchDBPublicFormAnswers = {
        _id: "formAnswers:" + new Date().getTime(),
        formFilename: formFilename,
        formAnswers: formAnswers,
      };

      const result: PouchDBPutResult = await this.localPouchDB.put(pouchDbFormAnswers);
      console.log("Saved form answers: " + result.id + " Revision: " + result.rev);
      await this.delay(500);

      return "Saved form answers: " + result.id + " Revision: " + result.rev;
    } catch (error) {
      console.error('Error saving form answers:', error);
      throw new Error('Failed to save form answers');
    }
  }


  handleChange(change:any) {
    let changedDoc = null;
    let changedIndex = null;
    // Detecting that the document has changed
    this.data.forEach((doc:any, index:any) => {
      if(doc._id === change.id){
        changedDoc = doc;
        changedIndex = index;
      }
    });
    //A document was deleted
    if(change.deleted){
      this.data.splice(changedIndex, 1);
    }
    else {
      //A document was updated
      if(changedDoc && changedIndex){
        this.data[changedIndex] = change.doc;
      }
      //A document was added
      else {
        this.data.push(change.doc);
      }
    }
  }

  updateFormAnswers(_id: any, formAnswers: any) {
    this.localPouchDB.get(_id).then( (doc: any) => {
      doc.formAnswers = formAnswers
      return this.localPouchDB.put(doc);
    });
  }

  deleteFormAnswers(_id: any){
    var promise = this.localPouchDB.get(_id).then((doc:PouchDBGetResult) => {
      return this.localPouchDB.remove(doc._id, doc._rev);
    })
    .then((result: PouchDBRemoveResult): void => {
      return;
    });

    return promise;
  }
}
