import { BadRequestException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { oauthError } from './utils';
import { OAUTH_SCOPES } from './constants';
import { DatabaseService } from '../db/database.service';
import { WorkspaceService } from '../workspace.service';

type Limit = { count: number; resetAt: number };

export abstract class OAuthBaseService {
  protected readonly rateLimits = new Map<string, Limit>();
  constructor(protected readonly database: DatabaseService, protected readonly workspaces: WorkspaceService) {}

  appOrigin(): string {
    const configured = process.env.APP_ORIGIN ?? 'http://localhost:5173';
    const url = new URL(configured);
    return url.origin;
  }

  mcpUrl(): string { return `${this.appOrigin()}/mcp`; }

  assertCanonicalRequest(request: FastifyRequest): void {
    const canonical = new URL(this.appOrigin());
    const forwardedHost = request.headers['x-forwarded-host'];
    const host = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost ?? request.headers.host;
    const forwardedProto = request.headers['x-forwarded-proto'];
    const proto = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)?.split(',')[0]?.trim();
    if (host && host !== canonical.host) throw new BadRequestException('The request host does not match the configured Anklav origin.');
    if (proto && proto !== canonical.protocol.slice(0, -1)) throw new BadRequestException('The request protocol does not match the configured Anklav origin.');
  }

  protectedResourceMetadata() {
    return {
      resource: this.mcpUrl(),
      authorization_servers: [this.appOrigin()],
      scopes_supported: [...OAUTH_SCOPES],
      bearer_methods_supported: ['header'],
      resource_documentation: `${this.appOrigin()}/api/docs`,
    };
  }

  authorizationServerMetadata() {
    const origin = this.appOrigin();
    return {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      revocation_endpoint: `${origin}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: [...OAUTH_SCOPES],
    };
  }

  protected limit(bucket: string, key: string, maximum: number, windowMs: number): void {
    const now = Date.now();
    const mapKey = `${bucket}:${key}`;
    const current = this.rateLimits.get(mapKey);
    if (!current || current.resetAt <= now) {
      this.rateLimits.set(mapKey, { count: 1, resetAt: now + windowMs });
      return;
    }
    if (current.count >= maximum) throw oauthError('slow_down', 'Too many requests. Try again later.');
    current.count += 1;
  }


}
