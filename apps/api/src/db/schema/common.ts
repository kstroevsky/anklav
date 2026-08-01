import { timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from '../../common/ids';

export const id = () => uuid('id').primaryKey().$defaultFn(uuidv7);
export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
