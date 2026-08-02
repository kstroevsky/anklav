import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

export async function startStdioBridge(origin: string, accessToken: string): Promise<void> {
  const client = new Client({ name: 'anklav-mcp-bridge', version: '0.1.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
  });
  await client.connect(transport);

  const server = new Server({ name: 'anklav-mcp-bridge', version: '0.1.0' }, { capabilities: { tools: {}, resources: {} } });
  server.setRequestHandler(ListToolsRequestSchema, (request) => client.listTools(request.params));
  server.setRequestHandler(CallToolRequestSchema, (request) => client.callTool(request.params));
  server.setRequestHandler(ListResourcesRequestSchema, (request) => client.listResources(request.params));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, (request) => client.listResourceTemplates(request.params));
  server.setRequestHandler(ReadResourceRequestSchema, (request) => client.readResource(request.params));
  await server.connect(new StdioServerTransport());

  const close = async () => {
    await client.close();
    await server.close();
  };
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
}
