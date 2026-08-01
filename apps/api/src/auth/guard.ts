import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthService } from './service';
import type { AuthedRequest } from './types';

export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const session = await this.auth.validateSession((request as FastifyRequest & { cookies?: Record<string, string> }).cookies?.anklav_session);
    if (!session) throw new UnauthorizedException();
    const authed = request as AuthedRequest;
    authed.user = session;
    authed.sessionId = session.sessionId;
    authed.csrfToken = session.csrfToken;
    const method = request.method.toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && request.headers['x-csrf-token'] !== session.csrfToken) {
      throw new UnauthorizedException('CSRF token is missing or invalid.');
    }
    return true;
  }
}



