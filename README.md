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
