#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListResourceTemplatesRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';

type Credentials = { origin: string; clientId: string; clientName: string; accessToken: string; refreshToken: string; expiresAt: number };
type CredentialStore = Record<string, Credentials>;

async function main() {
  const [command, suppliedOrigin] = process.argv.slice(2);
  const origin = normalizeOrigin(suppliedOrigin ?? process.env.ANKLAV_ORIGIN);
  if (command === 'login') return login(origin);
  if (command === 'stdio') return stdio(origin);
  if (command === 'logout') return logout(origin);
  console.error('Usage: anklav-mcp <login|stdio|logout> <https://anklav.example>'); process.exitCode = 2;
}

async function login(origin: string) {
  const callback = await startCallback();
  const verifier = randomBytes(48).toString('base64url'); const challenge = createHash('sha256').update(verifier).digest('base64url'); const state = randomBytes(24).toString('base64url');
  const registration = await json(`${origin}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Anklav MCP workspace bridge', redirect_uris: [callback.redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) });
  const authorize = new URL(`${origin}/oauth/authorize`);
  authorize.search = new URLSearchParams({ response_type: 'code', client_id: registration.client_id, redirect_uri: callback.redirectUri, code_challenge: challenge, code_challenge_method: 'S256', scope: 'anklav:read anklav:write', resource: `${origin}/mcp`, state }).toString();
  console.error(`Open this URL to authorize Anklav MCP:\n${authorize}`); openBrowser(authorize.toString());
  try {
    const params = await callback.wait;
    if (params.get('state') !== state || params.get('iss') !== origin || !params.get('code')) throw new Error('OAuth callback state or issuer verification failed.');
    const tokens = await form(`${origin}/oauth/token`, { grant_type: 'authorization_code', code: params.get('code')!, redirect_uri: callback.redirectUri, code_verifier: verifier, client_id: registration.client_id, resource: `${origin}/mcp` });
    await saveCredentials({ origin, clientId: registration.client_id, clientName: registration.client_name, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + Number(tokens.expires_in) * 1000 });
    console.error(`Anklav MCP login completed for ${origin}.`);
  } finally { callback.close(); }
}

async function stdio(origin: string) {
  let credentials = await loadCredentials(origin);
  if (!credentials) throw new Error(`No Anklav MCP credentials for ${origin}. Run: anklav-mcp login ${origin}`);
  if (credentials.expiresAt <= Date.now() + 60_000) credentials = await refresh(credentials);
  const client = new Client({ name: 'anklav-mcp-bridge', version: '0.1.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { requestInit: { headers: { authorization: `Bearer ${credentials.accessToken}` } } });
  await client.connect(transport);
  const server = new Server({ name: 'anklav-mcp-bridge', version: '0.1.0' }, { capabilities: { tools: {}, resources: {} } });
  server.setRequestHandler(ListToolsRequestSchema, (request) => client.listTools(request.params));
  server.setRequestHandler(CallToolRequestSchema, (request) => client.callTool(request.params));
  server.setRequestHandler(ListResourcesRequestSchema, (request) => client.listResources(request.params));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, (request) => client.listResourceTemplates(request.params));
  server.setRequestHandler(ReadResourceRequestSchema, (request) => client.readResource(request.params));
  await server.connect(new StdioServerTransport());
  const close = async () => { await client.close(); await server.close(); };
  process.once('SIGINT', () => { void close(); }); process.once('SIGTERM', () => { void close(); });
}

async function logout(origin: string) {
  const store = await readStore(); if (!store[origin]) { console.error(`No Anklav MCP credentials for ${origin}.`); return; }
  delete store[origin]; await writeStore(store); console.error(`Removed local Anklav MCP credentials for ${origin}.`);
}

async function refresh(credentials: Credentials): Promise<Credentials> {
  const tokens = await form(`${credentials.origin}/oauth/token`, { grant_type: 'refresh_token', refresh_token: credentials.refreshToken, client_id: credentials.clientId, resource: `${credentials.origin}/mcp` });
  const next = { ...credentials, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + Number(tokens.expires_in) * 1000 }; await saveCredentials(next); return next;
}

async function startCallback() {
  let resolve!: (params: URLSearchParams) => void; let reject!: (error: Error) => void;
  const wait = new Promise<URLSearchParams>((yes, no) => { resolve = yes; reject = no; });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/callback') { response.statusCode = 404; response.end(); return; }
    response.setHeader('content-type', 'text/html; charset=utf-8'); response.end('<!doctype html><title>Anklav MCP</title><p>Authorization complete. You may close this tab.</p>'); resolve(url.searchParams);
  });
  await new Promise<void>((resolveReady, rejectReady) => server.once('error', rejectReady).listen(0, '127.0.0.1', resolveReady));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Loopback callback did not start.');
  return { redirectUri: `http://127.0.0.1:${address.port}/callback`, wait, close: () => { server.close(); reject(new Error('OAuth login was cancelled.')); } };
}

function openBrowser(url: string) {
  const [command, args] = platform() === 'darwin' ? ['open', [url]] : platform() === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' }); child.unref();
}

function normalizeOrigin(value: string | undefined): string {
  if (!value) throw new Error('Anklav origin is required. Example: anklav-mcp login https://anklav.example');
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Origin must be an absolute HTTP(S) origin without a path.');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Plain HTTP is allowed only for loopback development.');
  return url.origin;
}

function configPath(): string { const base = process.env.XDG_CONFIG_HOME ?? (platform() === 'darwin' ? join(homedir(), 'Library', 'Application Support') : join(homedir(), '.config')); return join(base, 'anklav', 'mcp-credentials.json'); }
async function readStore(): Promise<CredentialStore> { try { return JSON.parse(await readFile(configPath(), 'utf8')) as CredentialStore; } catch (error: any) { if (error?.code === 'ENOENT') return {}; throw error; } }
async function loadCredentials(origin: string): Promise<Credentials | undefined> { return (await readStore())[origin]; }
async function saveCredentials(credentials: Credentials): Promise<void> { const store = await readStore(); store[credentials.origin] = credentials; await writeStore(store); }
async function writeStore(store: CredentialStore): Promise<void> { const path = configPath(); await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const temporary = `${path}.${process.pid}.tmp`; await writeFile(temporary, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 }); await rename(temporary, path); }
async function json(url: string, init: RequestInit): Promise<any> { const response = await fetch(url, init); if (!response.ok) throw new Error(`OAuth request failed (${response.status}).`); return response.json(); }
async function form(url: string, body: Record<string, string>): Promise<any> { return json(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) }); }

export { normalizeOrigin };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => { console.error(error instanceof Error ? error.message : 'Anklav MCP command failed.'); process.exitCode = 1; });
}
