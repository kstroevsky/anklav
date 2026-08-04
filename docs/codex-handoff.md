# Codex handoff runbook

This is Anklav's deliberately narrow usable workflow: keep a task, its normalized Codex activity, its checkpoint, and its exact Git working state available when work moves to another computer. It does not try to recreate Codex's private live conversation UI on another account.

## What is transferred

- the workspace, project, repository, task contract, and run lineage;
- normalized user and assistant messages, reasoning summaries, tool calls and results, patch events, interruptions, and compaction markers from the local Codex rollout;
- the last checkpoint, completed and remaining work, relevant paths, and next action;
- the Git commit identity, branch, dependency-lock hashes, changed paths, and exact binary-capable patch for tracked, staged, and untracked files;
- a generated Codex-oriented continuation document.

Credentials, raw account identity, and arbitrary files outside the Git patch are not transferred. Token, private-key, authenticated-URL, authorization-header, cookie, and structured secret patterns are redacted from normalized session activity. Content that still matches a known credential shape after deterministic redaction is withheld rather than uploaded. A dirty Git patch is stored as access-controlled evidence because it must remain byte-exact to be restorable; treat the Anklav database and backups as sensitive developer infrastructure.

## One-time deployment setup

Run one shared Anklav deployment reachable by both computers. Localhost HTTP is supported for development. A shared deployment must use HTTPS, with `APP_ORIGIN` and `PUBLIC_BASE_URL` set to its canonical external origin.

Create the initial user, workspace, and project in the web interface. Give every Anklav account that should participate access to that workspace. The Codex accounts on the computers may be different.

Install the CLI from the same Anklav checkout on both computers:

```bash
pnpm install --frozen-lockfile
pnpm --filter @anklav/mcp build
npm install --global ./apps/mcp
```

The installed package provides both `anklav` and the backward-compatible `anklav-mcp` executable. OAuth credentials are stored per Anklav origin in the operating system's private configuration directory. Repository binding and continuation state are stored with mode `0600` under the repository's actual Git directory, not in committed files.

## Computer A: start and checkpoint

From the repository:

```bash
anklav login https://anklav.example
anklav bind --origin https://anklav.example --workspace "Workspace name" --project "Project name"
anklav start "A concise task title" --objective "The verifiable outcome"
```

If the repository has no registered remote, it is bound under a `local/<directory>` identity. Cross-computer handoff is clearest with the same `owner/repository` remote on both clones.

Run `anklav sync` whenever an immediate server copy of the latest Codex activity is useful. It is incremental and safe to repeat. Normally `checkpoint` and `finish` synchronize automatically.

Before switching computers:

```bash
anklav checkpoint \
  --summary "Implemented the parser and verified its unit tests" \
  --next "Run the Docker-level OAuth handoff test"
```

The summary is optional. When omitted, Anklav uses the latest normalized assistant message, then falls back to Git facts. The checkpoint releases the write lease so another run can continue the task.

## Computer B: continue

Clone or fetch the same repository and check out a commit compatible with the checkpoint. The safest starting state is the checkpoint's clean base commit.

```bash
anklav login https://anklav.example
anklav bind --origin https://anklav.example --workspace "Workspace name" --project "Project name"
anklav continue ANK-123
```

If exactly one active task exists in the project, the identifier can be omitted. The command:

1. loads the latest handoff projection;
2. rejects the wrong repository, a divergent commit, conflicting local edits, or a checkpoint whose dirty state was not captured;
3. restores the checkpoint patch only into a clean compatible checkout and verifies the resulting SHA-256 hash;
4. creates a child run and claims a write lease;
5. prints the continuation document and saves it to `.git/anklav/continuation.md`.

Start the new Codex work with the printed document as its authoritative task context. The document explicitly treats retrieved evidence as untrusted data and gives the current task contract and verified Git state precedence.

Useful commands:

```bash
anklav status
anklav sync
anklav checkpoint --next "Describe the next concrete action"
anklav finish --status completed --summary "Acceptance criteria pass"
anklav logout https://anklav.example
```

`finish` ends the active run; it does not automatically move the task through a project-specific workflow state.

## Explicit session selection

Discovery uses the newest `.jsonl` Codex rollout whose metadata path is this repository. Set `CODEX_HOME` when Codex uses a non-default configuration directory, or pass a rollout explicitly:

```bash
anklav start "Task title" --session /absolute/path/to/rollout.jsonl
anklav sync --session /absolute/path/to/rollout.jsonl
```

An explicit rollout is rejected when its repository path does not match the current checkout.

## Import existing Codex history

After binding the repository, existing completed rollouts can be attached to an explicit archival task. Preview the repository-scoped selection first:

```bash
anklav import-codex ANK-123 --dry-run
anklav import-codex ANK-123 --since 2026-07-01 --limit 50
```

Discovery scans `$CODEX_HOME/sessions` by default. Use `--sessions-root /absolute/directory` for another read-only rollout directory. Only sessions whose recorded working directory is the current repository or one of its subdirectories are eligible. The importer skips incomplete and previously attached sessions by default; `--include-incomplete` is available for an intentional partial archive.

Every imported rollout gets a completed, non-modifying archival run, an idempotent normalized-session ingestion, and a short outcome record. Raw JSONL files and account credentials are not uploaded. A parsing or ingestion failure is reported by file name, marks a started archival run failed, releases its read lease, and causes a non-zero CLI exit status.

## MVP boundaries

- The CLI transfers durable task context and Git state, not a provider-private live chat or provider credentials.
- A single rollout is attached to a run. Finish the run before intentionally switching to another rollout.
- Git submodule working-tree contents, ignored files, and filesystem metadata are not embedded in the dirty patch. Commit or transfer those separately.
- Automatic patch restoration refuses divergence and conflicting local edits. Resolve those conditions with normal Git operations, then retry.
- Session normalization is capped at 64 MiB per rollout in this MVP.
- Production deployment, TLS, database backup, monitoring, and membership administration remain operator responsibilities.

These constraints preserve a predictable recovery path: Anklav will stop with an actionable error before it guesses about incompatible source state.
