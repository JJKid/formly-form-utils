// src/lib/tokens/db-config.token.ts
import { InjectionToken } from '@angular/core';
import { DBConfig } from './db-config.interface';

export const DB_CONFIG = new InjectionToken<DBConfig>('DB_CONFIG');
