# Anklav

Anklav is a self-hosted control room for software-development work: projects provide technical ownership, flows provide continuity of purpose, and tasks connect the two.

## Run locally

Requirements: Node 22+, pnpm 11+, and Docker Desktop (or another Docker daemon).

1. Copy `.env.example` to `.env` and replace every secret value. The setup token is the `ANKLAV_SETUP_TOKEN` value in that file; generate one with `openssl rand -base64 32`.
2. Start the stack:

   ```bash
   docker compose up --build
   ```

3. Open `http://localhost:8080`, enter the configured setup-token value, and create the initial instance administrator and workspace.

The API is proxied through the same origin at `/api/v1`; Swagger is available at `http://localhost:8080/api/docs`.

For development without the web container, start PostgreSQL with Compose, set `DATABASE_URL` for localhost, then run:

```bash
pnpm dev
```

## Architecture

Start with [the architecture guide](docs/architecture.md) for the runtime map, data boundaries, optional integrations, and a plain-language explanation of self-hosting.

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
pnpm --filter @anklav/api import:anklav plan -- --bundle /absolute/path/to/project-control/migration/anklav/v1 --workspace 'Personal R&D' --verify-checksums --require-source-mappings
```

For the guarded project-control migration, override decisions, immutable-bundle rules, verification reporting, and rollback behavior, see [the migration runbook](docs/migration-anklav.md).

## Self-hosting notes

Compose is intentionally HTTP-only inside the deployment. Put a TLS-terminating reverse proxy such as Caddy, Traefik, or Nginx in front of it for production. HTTPS is required for PWA installation outside `localhost`.

PostgreSQL data is stored in the `anklav-postgres` Docker volume. The first release intentionally does not automate backup/export; protect this volume with your normal infrastructure backup process.

The GitHub integration is disabled by default. To enable it, provide a public HTTPS `PUBLIC_BASE_URL`, a base64 32-byte `INTEGRATION_ENCRYPTION_KEY`, and set `GITHUB_INTEGRATION_ENABLED=true`; workspace administrators can then create and install a dedicated GitHub App from the GitHub page in Anklav. Repository source and diffs are fetched on demand and are not persisted.

## Cross-device Codex handoff

The `anklav` CLI is the usable handoff path between Codex installations, including installations signed in to different Codex accounts. Both computers authenticate to the same Anklav deployment; Codex account identity is not used to join the work.

Build and install the CLI from this checkout on each computer:

```bash
pnpm install --frozen-lockfile
pnpm --filter @anklav/mcp build
npm install --global ./apps/mcp
anklav help
```

Then, from a clone of the repository:

```bash
anklav login https://anklav.example
anklav bind --origin https://anklav.example --workspace "Personal" --project "Anklav"
anklav start "Make session handoff usable" --objective "A second computer can resume safely"
```

`start` discovers the current repository's Codex rollout under `$CODEX_HOME/sessions`; `sync` uploads newly appended normalized activity. Before leaving computer A:

```bash
anklav checkpoint --next "Run the remaining acceptance test"
```

On computer B, clone or update the same repository, log in, bind it, and continue by human-readable task identifier:

```bash
anklav login https://anklav.example
anklav bind --origin https://anklav.example --workspace "Personal" --project "Anklav"
anklav continue ANK-123
```

The command verifies the repository and commit relationship, restores the exact captured dirty patch when the checkout is clean, starts a child run, and prints the handoff context. It also saves that context privately under `.git/anklav/continuation.md`. Use `anklav status` to inspect the binding and active run, and `anklav finish` when the run is done.

See [the Codex handoff runbook](docs/codex-handoff.md) for the complete two-computer procedure, safety behavior, and current MVP boundaries.

## MCP access for coding agents

Anklav exposes an OAuth-protected Streamable HTTP MCP server at `https://your-anklav.example/mcp`. It uses dynamic client registration, authorization-code flow with PKCE, opaque rotating tokens, and workspace selection at consent time. Connected clients can be reviewed and revoked in **Settings → Connected clients**.

Use the remote endpoint in Codex or Claude Code when the host supports browser OAuth. For hosts that require stdio, build the private bridge from this checkout:

```bash
pnpm --filter @anklav/mcp build
node apps/mcp/dist/main.js login https://your-anklav.example
node apps/mcp/dist/main.js mcp https://your-anklav.example
```

The bridge prints the authorization URL to stderr as well as attempting to open it, stores credentials per origin in the platform configuration directory with user-only permissions, refreshes tokens, and never writes credentials to stdout. `logout` removes its local credentials.

Example stdio configuration:

```json
{
  "mcpServers": {
    "anklav": {
      "command": "node",
      "args": ["/absolute/path/to/anklav/apps/mcp/dist/main.js", "mcp", "https://your-anklav.example"]
    }
  }
}
```

MCP clients receive `anklav:read` and optionally `anklav:write`; every grant is also restricted to the workspaces selected by the user. Agents can read and manage projects, flows, tasks, comments, labels, checklists, convergence criteria, and relations. They cannot administer accounts, workspaces, memberships, or workflows; decide human reviews; or delete and restore records.

Production OAuth requires an HTTPS-terminating reverse proxy and `APP_ORIGIN` set to the canonical external origin. Plain HTTP is supported only for loopback development.
