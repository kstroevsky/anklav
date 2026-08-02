import { platform } from 'node:os';

export function normalizeOrigin(value: string | undefined): string {
  if (!value) throw new Error('Anklav origin is required. Example: anklav-mcp login https://anklav.example');

  const url = new URL(value);
  const validProtocol = ['https:', 'http:'].includes(url.protocol);
  const hasPathComponents = url.pathname !== '/' || url.search || url.hash || url.username || url.password;

  if (!validProtocol || hasPathComponents) {
    throw new Error('Origin must be an absolute HTTP(S) origin without a path.');
  }
  if (url.protocol === 'http:' && !isLoopback(url.hostname)) {
    throw new Error('Plain HTTP is allowed only for loopback development.');
  }

  return url.origin;
}

function isLoopback(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}
