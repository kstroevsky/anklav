import type { ClientRegistration, TokenResponse } from './types.js';

type AuthorizationUrlInput = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
};

type ExchangeCodeInput = {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  clientId: string;
};

export class OAuthClient {
  constructor(private readonly origin: string) {}

  async register(redirectUri: string, clientName: string): Promise<ClientRegistration> {
    return this.requestJson<ClientRegistration>('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: clientName,
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    });
  }

  authorizationUrl(input: AuthorizationUrlInput): string {
    const authorize = new URL(`${this.origin}/oauth/authorize`);
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
      scope: 'anklav:read anklav:write',
      resource: `${this.origin}/mcp`,
      state: input.state,
    }).toString();
    return authorize.toString();
  }

  exchangeCode(input: ExchangeCodeInput): Promise<TokenResponse> {
    return this.form<TokenResponse>('/oauth/token', {
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
      client_id: input.clientId,
      resource: `${this.origin}/mcp`,
    });
  }

  refresh(refreshToken: string, clientId: string): Promise<TokenResponse> {
    return this.form<TokenResponse>('/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      resource: `${this.origin}/mcp`,
    });
  }

  private async requestJson<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.origin}${path}`, init);
    if (!response.ok) throw new Error(`OAuth request failed (${response.status}).`);
    return response.json() as Promise<T>;
  }

  private form<T>(path: string, body: Record<string, string>): Promise<T> {
    return this.requestJson<T>(path, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
  }
}
