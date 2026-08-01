-- Phase 1.1: decisions, verification, and reapplication must remain auditable.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "verification_requirements" text NOT NULL DEFAULT '';
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "non_goals" text NOT NULL DEFAULT '';
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone;

-- Existing pre-Phase-1.1 batches cannot be resumed without an explicit amendment.
UPDATE "import_batches" SET "overrides_hash" = 'legacy-unfrozen:' || "id"::text WHERE "overrides_hash" IS NULL;
ALTER TABLE "import_batches" ALTER COLUMN "overrides_hash" SET NOT NULL;
ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "amends_batch_id" uuid REFERENCES "import_batches"("id");
DROP INDEX IF EXISTS "import_batch_source_checksum_unique";
CREATE INDEX IF NOT EXISTS "import_batch_source_checksum_index" ON "import_batches" USING btree ("external_source_id", "bundle_checksum");

ALTER TABLE "external_object_mappings" ADD COLUMN IF NOT EXISTS "superseded_at" timestamp with time zone;
ALTER TABLE "external_object_mappings" ADD COLUMN IF NOT EXISTS "superseded_by_batch_id" uuid REFERENCES "import_batches"("id");
UPDATE "external_object_mappings" SET "superseded_at" = now() WHERE "status" = 'rolled_back' AND "superseded_at" IS NULL;
DROP INDEX IF EXISTS "external_object_mapping_workspace_source_key_unique";
DROP INDEX IF EXISTS "external_object_mapping_import_key_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "external_object_mapping_workspace_source_key_active_unique" ON "external_object_mappings" USING btree ("workspace_id", "source_key") WHERE "superseded_at" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "external_object_mapping_import_key_active_unique" ON "external_object_mappings" USING btree ("import_key") WHERE "superseded_at" IS NULL;

CREATE TABLE IF NOT EXISTS "import_verification_attempts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "import_batch_id" uuid NOT NULL REFERENCES "import_batches"("id"),
  "report_path" text NOT NULL,
  "report_checksum" text NOT NULL,
  "checks" jsonb NOT NULL DEFAULT '[]',
  "failures" jsonb NOT NULL DEFAULT '[]',
  "warnings" jsonb NOT NULL DEFAULT '[]',
  "attempted_at" timestamp with time zone NOT NULL DEFAULT now(),
  "attempted_by_user_id" uuid REFERENCES "users"("id")
);
CREATE INDEX IF NOT EXISTS "import_verification_attempt_batch_index" ON "import_verification_attempts" USING btree ("import_batch_id", "attempted_at");
