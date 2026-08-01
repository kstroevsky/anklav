import { All, Controller, Req, Res } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { OAUTH_READ_SCOPE, OAuthService } from '../oauth';
import { McpService } from './service';

@Controller()
export class McpController {
  constructor(private readonly oauth: OAuthService, private readonly mcp: McpService) {}

  @All('mcp')
  async handle(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    try {
      this.oauth.assertCanonicalRequest(request);
      const principal = await this.oauth.authenticateMcp(request.headers.authorization);
      const server = this.mcp.createServer(principal);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authentication is required.';
      const metadata = `${this.oauth.appOrigin()}/.well-known/oauth-protected-resource/mcp`;
      if (!reply.sent) reply.header('www-authenticate', `Bearer resource_metadata="${metadata}", scope="${OAUTH_READ_SCOPE}"`).code(401).send({ error: 'unauthorized', error_description: message });
    }
  }
}


