import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { DatabaseService } from './database.service';

async function run() {
  const database = new DatabaseService();
  await migrate(database.db, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
  await database.onModuleDestroy();
}

void run();
