import { describe, expect, it } from 'vitest';
import { normalizeOrigin } from '../src/main.js';

describe('MCP bridge origin validation', () => {
  it('accepts HTTPS origins and loopback HTTP', () => {
    expect(normalizeOrigin('https://anklav.example')).toBe('https://anklav.example');
    expect(normalizeOrigin('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
  });

  it('rejects non-loopback HTTP and origins with paths', () => {
    expect(() => normalizeOrigin('http://anklav.example')).toThrow('Plain HTTP');
    expect(() => normalizeOrigin('https://anklav.example/mcp')).toThrow('Origin must');
  });
});
