# Project-control migration (Phase 1.1 safety gate)

Anklav consumes the checked neutral bundle from `project-control/migration/anklav/v1`; it does not copy, modify, or generate files inside that directory. The supported contract is bundle schema `1.2.0`.

Run the project-control verifier before any Anklav command. Then run a no-write plan from `apps/api`:

```bash
pnpm import:anklav plan \
  --bundle /absolute/path/to/project-control/migration/anklav/v1 \
  --workspace 'Personal R&D' \
  --verify-checksums \
  --require-source-mappings
```

The target workspace must already exist. The importer never creates a workspace. The plan prints an overrides template; save it outside the bundle. `apply` refuses to run until it contains an explicit source-repository visibility decision, dispositions for all project-control tasks, and decisions for human-review milestone classifications.

```bash
pnpm import:anklav apply \
  --bundle /absolute/path/to/project-control/migration/anklav/v1 \
  --workspace 'Personal R&D' \
  --overrides /secure/path/anklav-overrides.json \
  --actor <anklav-user-uuid> \
  --verify-checksums \
  --require-source-mappings
```

The bundle checksum plus a canonical hash of the overrides is the immutable identity of an execution. `apply`, `resume`, `verify`, and `rollback` reject different overrides. A completed execution is a no-op only for the identical decision set. To change decisions after any write, roll back under the guarded rules and run a clean new `apply`; the rolled-back batch retires its mappings from matching and the new batch restores only objects that it had created.

Each target and its external-object mapping are written in one database transaction. A repeated source key whose payload hash changes becomes a drift conflict; Anklav never overwrites the target silently.

Verification writes only outside the bundle:

```bash
pnpm import:anklav verify \
  --bundle /absolute/path/to/project-control/migration/anklav/v1 \
  --workspace 'Personal R&D' \
  --overrides /secure/path/anklav-overrides.json \
  --actor <anklav-user-uuid> \
  --verification-report ../../migration/anklav/verification/anklav-import-verification.json
```

The command produces both `anklav-import-verification.json` and `anklav-import-verification.json.sha256`. They are intentionally ignored by Git because they can contain operational source URLs. The importer rejects output beneath the immutable bundle, path traversal, symlinks, oversized files, and oversized NDJSON records.

The report has authoritative top-level `passed`, `checks`, `failures`, `warnings`, `outcomes`, `resolvedConflicts`, and `remainingHumanDecisions` fields. A failed attempt is stored only as `verification_failed`; it does not update source mappings’ `lastVerifiedAt`, create a successful verification record, or write a `verified` activity. REST callers cannot choose a filesystem path: the server derives the report file beneath its configured verification directory.

Rollback is scoped to objects that the recorded import batch created, including the automatically created Anklav project. It never deletes matched pre-existing objects. If a created object’s version changed after import, rollback refuses unless a human supplies `--guarded-override`; soft deletion increments the target version and migration history remains intact.

Git-backed artifact candidates are link-only: the importer records repository/path provenance but does not copy repository content. Verification is server-side through the existing GitHub App: it checks workspace repository access, reads the specified path at the immutable commit SHA, hashes its content, and records success or a missing/changed-file result. Neither REST callers nor agents can self-assert `verified` or promote an artifact to canonical; canonical promotion is an admin gate after server verification. Imported Linear documents are `legacy_source` candidate artifacts and do not supersede Git-backed material.

Task import keeps requirements, performed verification, completion evidence, non-goals, limitations, and follow-up work distinct. Current source evidence is not silently treated as completion evidence. Deterministic context packs include task relations/blockers, task-specific milestones, import provenance and original source URLs, and select the latest handoff by timestamp.

This phase deliberately excludes raw-session ingestion, RAG, embeddings, work attempts, and autonomous workflows. Context packs are deterministic structured data with verified/canonical artifact citations; semantic material is not included.
