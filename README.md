# Anklav

Anklav is a self-hosted control room for software-development work: projects provide technical ownership, flows provide continuity of purpose, and tasks connect the two.

## Run locally

Requirements: Node 22+, pnpm 11+, and Docker Desktop (or another Docker daemon).

1. Copy `.env.example` to `.env` and replace every secret value.
2. Start the stack:

   ```bash
   docker compose up --build
   ```

3. Open `http://localhost:8080`, enter `ANKLAV_SETUP_TOKEN`, and create the initial instance administrator and workspace.

The API is proxied through the same origin at `/api/v1`; Swagger is available at `http://localhost:8080/api/docs`.

For development without the web container, start PostgreSQL with Compose, set `DATABASE_URL` for localhost, then run:

```bash
pnpm dev
```

## Architecture

- `apps/web` — React, Vite, responsive control-room UI, installable PWA shell.
- `apps/api` — NestJS/Fastify REST API, Drizzle schema/migrations, local session auth.
- `apps/mcp` — private OAuth login and stdio bridge for MCP hosts that do not use remote HTTP directly.
- `packages/api-client` — OpenAPI-generated TypeScript contract.

Useful commands:

```bash
pnpm test
pnpm build
pnpm generate:api
pnpm db:generate
pnpm db:migrate
```

## Self-hosting notes

Compose is intentionally HTTP-only inside the deployment. Put a TLS-terminating reverse proxy such as Caddy, Traefik, or Nginx in front of it for production. HTTPS is required for PWA installation outside `localhost`.

PostgreSQL data is stored in the `anklav-postgres` Docker volume. The first release intentionally does not automate backup/export; protect this volume with your normal infrastructure backup process.

The application has no external integrations, telemetry, agent execution, repository synchronization, or AI-session ingestion.

## MCP access for coding agents

Anklav exposes an OAuth-protected Streamable HTTP MCP server at `https://your-anklav.example/mcp`. It uses dynamic client registration, authorization-code flow with PKCE, opaque rotating tokens, and workspace selection at consent time. Connected clients can be reviewed and revoked in **Settings → Connected clients**.

Use the remote endpoint in Codex or Claude Code when the host supports browser OAuth. For hosts that require stdio, build the private bridge from this checkout:

```bash
pnpm --filter @anklav/mcp build
node apps/mcp/dist/main.js login https://your-anklav.example
node apps/mcp/dist/main.js stdio https://your-anklav.example
```

The bridge prints the authorization URL to stderr as well as attempting to open it, stores credentials per origin in the platform configuration directory with user-only permissions, refreshes tokens, and never writes credentials to stdout. `logout` removes its local credentials.

Example stdio configuration:

```json
{
  "mcpServers": {
    "anklav": {
      "command": "node",
      "args": ["/absolute/path/to/anklav/apps/mcp/dist/main.js", "stdio", "https://your-anklav.example"]
    }
  }
}
```

MCP clients receive `anklav:read` and optionally `anklav:write`; every grant is also restricted to the workspaces selected by the user. Agents can read and manage projects, flows, tasks, comments, labels, checklists, convergence criteria, and relations. They cannot administer accounts, workspaces, memberships, or workflows; decide human reviews; or delete and restore records.

Production OAuth requires an HTTPS-terminating reverse proxy and `APP_ORIGIN` set to the canonical external origin. Plain HTTP is supported only for loopback development.
