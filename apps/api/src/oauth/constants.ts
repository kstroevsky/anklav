import type { AuthUser } from '../auth';
import { z } from 'zod';

export const OAUTH_READ_SCOPE = 'anklav:read';
export const OAUTH_WRITE_SCOPE = 'anklav:write';
export const OAUTH_SCOPES = [OAUTH_READ_SCOPE, OAUTH_WRITE_SCOPE] as const;
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const AUTHORIZATION_REQUEST_TTL_MS = 10 * 60 * 1000;
export const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000;
export const CLIENT_INACTIVITY_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export type McpPrincipal = {
  user: AuthUser;
  client: { id: string; name: string };
  grantId: string;
  scopes: Set<string>;
  workspaceIds: Set<string>;
};

export const registrationSchema = z.object({
  client_name: z.string().trim().min(1).max(120),
  redirect_uris: z.array(z.string().min(1).max(2_048)).min(1).max(10),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
}).strict();

export const authorizationSchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string().uuid(),
  redirect_uri: z.string().min(1).max(2_048),
  code_challenge: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  code_challenge_method: z.literal('S256'),
  scope: z.string().min(1).max(200),
  state: z.string().max(2_048).optional(),
  resource: z.string().url().max(2_048),
});

export const tokenSchema = z.object({
  grant_type: z.enum(['authorization_code', 'refresh_token']),
  code: z.string().min(20).max(512).optional(),
  redirect_uri: z.string().min(1).max(2_048).optional(),
  code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/).optional(),
  refresh_token: z.string().min(20).max(512).optional(),
  client_id: z.string().uuid(),
  resource: z.string().url().max(2_048).optional(),
}).passthrough();

export type Registration = z.infer<typeof registrationSchema>;

