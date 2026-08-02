import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CredentialStoreRepository } from '../storage/credential-store.js';
import { refreshCredentials } from '../oauth/refresh.js';

export interface ToolClient {
  call<T = unknown>(name: string, arguments_: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
}

export async function connectToolClient(origin: string): Promise<ToolClient> {
  const store = new CredentialStoreRepository();
  let credentials = await store.find(origin);
  if (!credentials) throw new Error(`No Anklav credentials for ${origin}. Run: anklav login ${origin}`);
  if (credentials.expiresAt <= Date.now() + 60_000) credentials = await refreshCredentials(credentials, store);

  const client = new Client({ name: 'anklav-cli', version: '0.1.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${credentials.accessToken}` } },
  });
  await client.connect(transport);
  return {
    async call<T>(name: string, arguments_: Record<string, unknown>): Promise<T> {
      const result = await client.callTool({ name, arguments: arguments_ });
      const content = result.content as Array<{ type: string; text?: string }>;
      if (result.isError) {
        const message = content.find((entry) => entry.type === 'text');
        throw new Error(message?.text ?? `Anklav tool ${name} failed.`);
      }
      const structured = result.structuredContent as { result?: T } | undefined;
      if (structured && 'result' in structured) return structured.result as T;
      const text = content.find((entry) => entry.type === 'text');
      if (!text?.text) throw new Error(`Anklav tool ${name} returned no JSON result.`);
      return JSON.parse(text.text) as T;
    },
    close: () => client.close(),
  };
}
