import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, createdAt } from './common';
import { oauthTokenKind } from './enums';
import { users, workspaces } from './identity';

/** Public OAuth clients registered through the MCP dynamic-registration endpoint. */
export const oauthClients = pgTable('oauth_clients', {
  id: id(),
  name: text('name').notNull(),
  redirectUris: jsonb('redirect_uris').$type<string[]>().notNull(),
  clientIdIssuedAt: timestamp('client_id_issued_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (table) => [index('oauth_clients_expires_index').on(table.expiresAt)]);

export const oauthAuthorizationRequests = pgTable('oauth_authorization_requests', {
  id: id(),
  clientId: uuid('client_id').notNull().references(() => oauthClients.id),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  scopes: text('scopes').notNull(),
  state: text('state'),
  resource: text('resource').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (table) => [index('oauth_authorization_requests_expiry_index').on(table.expiresAt)]);

export const oauthGrants = pgTable('oauth_grants', {
  id: id(),
  clientId: uuid('client_id').notNull().references(() => oauthClients.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  scopes: text('scopes').notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (table) => [index('oauth_grants_user_index').on(table.userId), index('oauth_grants_client_index').on(table.clientId)]);

export const oauthAuthorizationCodes = pgTable('oauth_authorization_codes', {
  id: id(),
  codeHash: text('code_hash').notNull(),
  grantId: uuid('grant_id').notNull().references(() => oauthGrants.id),
  clientId: uuid('client_id').notNull().references(() => oauthClients.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  scopes: text('scopes').notNull(),
  resource: text('resource').notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('oauth_authorization_codes_hash_unique').on(table.codeHash), index('oauth_authorization_codes_expiry_index').on(table.expiresAt)]);

export const oauthTokens = pgTable('oauth_tokens', {
  id: id(),
  tokenHash: text('token_hash').notNull(),
  kind: oauthTokenKind('kind').notNull(),
  familyId: uuid('family_id').notNull(),
  grantId: uuid('grant_id').notNull().references(() => oauthGrants.id),
  clientId: uuid('client_id').notNull().references(() => oauthClients.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  scopes: text('scopes').notNull(),
  resource: text('resource').notNull(),
  replacedAt: timestamp('replaced_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('oauth_tokens_hash_unique').on(table.tokenHash), index('oauth_tokens_grant_index').on(table.grantId), index('oauth_tokens_family_index').on(table.familyId), index('oauth_tokens_expiry_index').on(table.expiresAt)]);

export const oauthGrantWorkspaces = pgTable('oauth_grant_workspaces', {
  grantId: uuid('grant_id').notNull().references(() => oauthGrants.id),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('oauth_grant_workspace_unique').on(table.grantId, table.workspaceId), index('oauth_grant_workspaces_workspace_index').on(table.workspaceId)]);
