import type { FastifyRequest } from 'fastify';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  instanceRole: 'user' | 'instance_admin';
  theme: 'system' | 'light' | 'dark';
  /** Present only for OAuth-authenticated MCP mutations; never persisted in a session. */
  mcpClient?: { id: string; name: string };
}

export type AuthedRequest = FastifyRequest & { user: AuthUser; sessionId: string; csrfToken: string };

