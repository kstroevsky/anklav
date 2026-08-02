import type { Credentials } from '../config/types.js';
import { CredentialStoreRepository } from '../storage/credential-store.js';
import { OAuthClient } from './client.js';

export async function refreshCredentials(credentials: Credentials, store: CredentialStoreRepository): Promise<Credentials> {
  const tokens = await new OAuthClient(credentials.origin).refresh(credentials.refreshToken, credentials.clientId);
  const next = {
    ...credentials,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + Number(tokens.expires_in) * 1000,
  };
  await store.save(next);
  return next;
}
