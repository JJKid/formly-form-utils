import { FormlyFieldConfig } from "@ngx-formly/core";
import { User } from "./user.interface";

export interface FormlyForm {
    _id?: any;
    filename: string;
    fields?: FormlyFieldConfig[] | any;
    author?: User | string;
    readers?: string[];
}
