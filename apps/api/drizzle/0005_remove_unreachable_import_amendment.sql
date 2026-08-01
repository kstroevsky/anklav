-- The initial Phase 1.1 amendment API had no reachable root planned batch.
-- Preserve the audit history in import_batches, but remove the unused column
-- with a forward-only migration instead of mutating the shipped migration.
ALTER TABLE "import_batches" DROP COLUMN IF EXISTS "amends_batch_id";
