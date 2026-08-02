import { createHash, randomBytes } from 'node:crypto';

export function createPkceRequest(): { verifier: string; challenge: string; state: string } {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(24).toString('base64url');
  return { verifier, challenge, state };
}
