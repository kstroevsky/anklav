import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { OAUTH_READ_SCOPE, OAUTH_SCOPES, type Registration } from './constants';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function validateRegistration(input: Registration): void {
  if (input.grant_types && (!sameSet(input.grant_types, ['authorization_code', 'refresh_token']) && !sameSet(input.grant_types, ['authorization_code']))) throw oauthError('invalid_client_metadata', 'Only authorization_code and refresh_token grants are supported.');
  if (input.response_types && !sameSet(input.response_types, ['code'])) throw oauthError('invalid_client_metadata', 'Only the code response type is supported.');
  if (input.token_endpoint_auth_method && input.token_endpoint_auth_method !== 'none') throw oauthError('invalid_client_metadata', 'Only public clients without a client secret are supported.');
  for (const redirectUri of input.redirect_uris) if (!isAllowedRedirectUri(redirectUri)) throw oauthError('invalid_redirect_uri', 'Redirect URIs must be HTTPS or an HTTP loopback URI without fragments, userinfo, or wildcards.');
}

export function isAllowedRedirectUri(value: string): boolean {
  if (value.includes('*')) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  } catch { return false; }
}

export function normalizeScopes(raw: string): string[] {
  const scopes = [...new Set(raw.trim().split(/\s+/).filter(Boolean))];
  if (!scopes.length || scopes.length > OAUTH_SCOPES.length || scopes.some((scope) => !OAUTH_SCOPES.includes(scope as typeof OAUTH_SCOPES[number])) || !scopes.includes(OAUTH_READ_SCOPE)) throw oauthError('invalid_scope', 'Request anklav:read and optionally anklav:write.');
  return scopes.sort();
}

export function splitScopes(scopes: string): string[] { return scopes.split(' ').filter(Boolean); }
export function hashToken(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function opaqueToken(): string { return randomBytes(32).toString('base64url'); }

export function verifyPkce(verifier: string, challenge: string): boolean {
  const actual = createHash('sha256').update(verifier).digest('base64url');
  return actual.length === challenge.length && timingSafeEqual(Buffer.from(actual), Buffer.from(challenge));
}

export function redirectWith(base: string, values: Record<string, string | null | undefined>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(values)) if (value !== null && value !== undefined) url.searchParams.set(key, value);
  return url.toString();
}

function sameSet(values: string[], allowed: string[]): boolean {
  return values.length === allowed.length && values.every((value) => allowed.includes(value));
}

export function oauthError(error: string, description: string): BadRequestException {
  return new BadRequestException({ oauthError: error, error_description: description });
}

export function oauthResult(error: unknown): { status: number; body: Record<string, string> } {
  if (error instanceof BadRequestException) {
    const response = error.getResponse();
    if (typeof response === 'object' && response && 'oauthError' in response) {
      const body = response as { oauthError: string; error_description: string };
      return { status: body.oauthError === 'slow_down' ? 429 : 400, body: { error: body.oauthError, error_description: body.error_description } };
    }
  }
  return { status: 400, body: { error: 'invalid_request', error_description: 'The token request is invalid.' } };
}

