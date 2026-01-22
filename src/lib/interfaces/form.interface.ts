import { User } from "./user.interface";

export interface Form {
    filename: string;
    addedFields: Array<any>;
    isImported?: boolean;
    author?: User | string;
    _id?: any;
    title?: string;
    description?: string;
    readers?: User[];
    questionCodes?: string[];
}
