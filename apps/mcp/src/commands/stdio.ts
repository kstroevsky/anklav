import { CredentialStoreRepository } from '../storage/credential-store.js';
import { refreshCredentials } from '../oauth/refresh.js';
import { startStdioBridge } from '../transport/stdio-bridge.js';

export async function runStdio(origin: string): Promise<void> {
  const credentialsStore = new CredentialStoreRepository();
  let credentials = await credentialsStore.find(origin);

  if (!credentials) {
    throw new Error(`No Anklav credentials for ${origin}. Run: anklav login ${origin}`);
  }
  if (credentials.expiresAt <= Date.now() + 60_000) {
    credentials = await refreshCredentials(credentials, credentialsStore);
  }

  await startStdioBridge(origin, credentials.accessToken);
}
