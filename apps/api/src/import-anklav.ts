import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DatabaseService } from './db/database.service';
import { users } from './db/schema';
import { eq } from 'drizzle-orm';
import type { AuthUser } from './auth';
import { PortfolioImportService, type ImportOverrides } from './portfolio-import.service';

type Flags = Record<string, string | boolean>;

function flags(argv: string[]): Flags {
  const result: Flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    result[key] = next && !next.startsWith('--') ? (index += 1, next) : true;
  }
  return result;
}

async function main() {
  const [command] = process.argv.slice(2);
  if (!['plan', 'apply', 'resume', 'verify', 'rollback'].includes(command ?? '')) throw new Error('Usage: import:anklav <plan|apply|resume|verify|rollback> --bundle <path> --workspace <id|name> [--overrides file] [--actor user-id] [--verification-report path] [--verify-checksums] [--require-source-mappings]');
  const args = flags(process.argv.slice(3));
  if (typeof args.bundle !== 'string' || typeof args.workspace !== 'string') throw new Error('--bundle and --workspace are required.');
  const overrides: ImportOverrides | undefined = typeof args.overrides === 'string' ? JSON.parse(await readFile(args.overrides, 'utf8')) as ImportOverrides : undefined;
  const request = { bundle: args.bundle, workspace: args.workspace, overrides, verifyChecksums: args['verify-checksums'] !== false, requireSourceMappings: Boolean(args['require-source-mappings']) };
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const database = app.get(DatabaseService);
  try {
    const importer = app.get(PortfolioImportService);
    if (command === 'plan') { process.stdout.write(`${JSON.stringify(await importer.plan(request), null, 2)}\n`); return; }
    if (typeof args.actor !== 'string') throw new Error('--actor is required for a mutating import command.');
    const [actorRow] = await database.db.select().from(users).where(eq(users.id, args.actor)).limit(1);
    if (!actorRow) throw new Error('The --actor user does not exist.');
    const actor: AuthUser = { id: actorRow.id, email: actorRow.email, displayName: actorRow.displayName, instanceRole: actorRow.instanceRole, theme: actorRow.theme === 'light' || actorRow.theme === 'dark' ? actorRow.theme : 'system' };
    if (command === 'apply') process.stdout.write(`${JSON.stringify(await importer.apply(request, actor), null, 2)}\n`);
    if (command === 'resume') process.stdout.write(`${JSON.stringify(await importer.resume(request, actor), null, 2)}\n`);
    if (command === 'verify') {
      const report = typeof args['verification-report'] === 'string' ? args['verification-report'] : resolve(process.cwd(), 'migration/anklav/verification/anklav-import-verification.json');
      process.stdout.write(`${JSON.stringify(await importer.verify(request, actor, report), null, 2)}\n`);
    }
    if (command === 'rollback') process.stdout.write(`${JSON.stringify(await importer.rollback(request, actor, args['guarded-override'] === true), null, 2)}\n`);
  } finally { await app.close(); }
}

void main();
