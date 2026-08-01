# Project-control migration (Phase 0–1)

Anklav consumes the checked neutral bundle from `project-control/migration/anklav/v1`; it does not copy, modify, or generate files inside that directory. The supported contract is bundle schema `1.2.0`.

Run the project-control verifier before any Anklav command. Then run a no-write plan from `apps/api`:

```bash
pnpm import:anklav plan \
  --bundle /absolute/path/to/project-control/migration/anklav/v1 \
  --workspace 'Personal R&D' \
  --verify-checksums \
  --require-source-mappings
```

The plan prints an overrides template. Save it outside the bundle. `apply` refuses to run until it contains an explicit source-repository visibility decision, dispositions for all project-control tasks, and decisions for human-review milestone classifications.

```bash
pnpm import:anklav apply \
  --bundle /absolute/path/to/project-control/migration/anklav/v1 \
  --workspace 'Personal R&D' \
  --overrides /secure/path/anklav-overrides.json \
  --actor <anklav-user-uuid> \
  --verify-checksums \
  --require-source-mappings
```

`apply` and `resume` are idempotent. Each target and its external-object mapping are written in one database transaction. A repeated source key whose payload hash changes becomes a drift conflict; Anklav never overwrites the target silently.

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

Rollback is scoped to objects that the recorded import batch created. It never deletes matched pre-existing objects. If a created object’s version changed after import, rollback refuses unless a human supplies `--guarded-override`.

Git-backed artifact candidates are link-only: the importer records repository/path provenance but does not copy repository content. A GitHub App connection may later verify the repository, commit SHA, and content hash. Imported Linear documents are `legacy_source` candidate artifacts and do not supersede Git-backed material.

This phase deliberately excludes raw-session ingestion, RAG, embeddings, work attempts, and autonomous workflows. Context packs are deterministic structured data with verified/canonical artifact citations; semantic material is not included.
