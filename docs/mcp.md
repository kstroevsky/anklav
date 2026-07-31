# Anklav MCP

The first-party MCP endpoint is Streamable HTTP at `/mcp`. It discovers its authorization server through `/.well-known/oauth-protected-resource/mcp` and supports public OAuth clients using dynamic registration and authorization-code PKCE (`S256`). Tokens are opaque, audience-bound to `/mcp`, and refresh tokens rotate.

## Remote hosts

Set the MCP server URL to `https://your-anklav.example/mcp`. Codex and Claude Code can complete browser OAuth from this endpoint. During consent, select only the workspaces that the client should access. A connected client can be revoked from **Settings → Connected clients** at any time.

## Stdio bridge

Build the bridge from this checkout and log in once per origin:

```bash
pnpm --filter @anklav/mcp build
node apps/mcp/dist/main.js login https://your-anklav.example
node apps/mcp/dist/main.js stdio https://your-anklav.example
node apps/mcp/dist/main.js logout https://your-anklav.example
```

`login` uses an ephemeral loopback callback and prints the authorization URL if it cannot open a browser. The bridge persists credentials only in the local platform config directory, with a `0600` file mode, and writes protocol traffic—not secrets—to stdout.

## Scope and boundaries

`anklav:read` is required for discovery and reads. `anklav:write` enables non-destructive core-work mutations. Every call also checks the grant's selected workspaces, current active membership, and the caller's normal Anklav role.

The tool surface intentionally excludes account/workspace/member/workflow administration, setup and password actions, human-review decisions, trash, and entity delete/restore. For state changes, clients must use `preview_transition` and acknowledge the exact returned warnings before a warned update can proceed.
