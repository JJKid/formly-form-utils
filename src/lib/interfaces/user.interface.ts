import { CustomField } from "./custom-field.interface";
import { Form } from "./form.interface";

export interface User {
  _id?: string;
  name: string;
  email: string;
  password?: string;
  username?: string;
  forms?: Form[];
  customFields?: CustomField[];
}
