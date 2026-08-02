import { CredentialStoreRepository } from '../storage/credential-store.js';
import { OAuthClient } from '../oauth/client.js';
import { createPkceRequest } from '../oauth/pkce.js';
import { startOAuthCallback } from '../oauth/callback.js';
import { openBrowser } from '../platform/browser.js';

const CLIENT_NAME = 'Anklav MCP workspace bridge';

export async function runLogin(origin: string): Promise<void> {
  const callback = await startOAuthCallback();
  const oauth = new OAuthClient(origin);
  const credentials = new CredentialStoreRepository();

  try {
    const pkce = createPkceRequest();
    const registration = await oauth.register(callback.redirectUri, CLIENT_NAME);
    const authorize = oauth.authorizationUrl({
      clientId: registration.client_id,
      redirectUri: callback.redirectUri,
      codeChallenge: pkce.challenge,
      state: pkce.state,
    });

    console.error(`Open this URL to authorize Anklav MCP:\n${authorize}`);
    openBrowser(authorize);

    const params = await callback.wait;
    assertCallback(params, origin, pkce.state);
    const tokens = await oauth.exchangeCode({
      code: params.get('code')!,
      redirectUri: callback.redirectUri,
      codeVerifier: pkce.verifier,
      clientId: registration.client_id,
    });

    await credentials.save({
      origin,
      clientId: registration.client_id,
      clientName: registration.client_name,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + Number(tokens.expires_in) * 1000,
    });
    console.error(`Anklav MCP login completed for ${origin}.`);
  } finally {
    callback.close();
  }
}

function assertCallback(params: URLSearchParams, origin: string, state: string): void {
  if (params.get('state') !== state || params.get('iss') !== origin || !params.get('code')) {
    throw new Error('OAuth callback state or issuer verification failed.');
  }
}
