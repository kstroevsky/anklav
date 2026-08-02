import { CredentialStoreRepository } from '../storage/credential-store.js';

export async function runLogout(origin: string): Promise<void> {
  const credentials = new CredentialStoreRepository();
  const removed = await credentials.remove(origin);

  if (!removed) {
    console.error(`No Anklav credentials for ${origin}.`);
    return;
  }
  console.error(`Removed local Anklav credentials for ${origin}.`);
}
