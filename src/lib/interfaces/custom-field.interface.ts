import { User } from "./user.interface";

export interface CustomField {
    _id?: any;
    name: null | string;
    filename: string | null;
    addedFields: Array<any>;
    author: User | string;
}
