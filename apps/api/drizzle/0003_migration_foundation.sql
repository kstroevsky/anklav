ALTER TYPE "activity_subject" ADD VALUE IF NOT EXISTS 'milestone';
ALTER TYPE "activity_subject" ADD VALUE IF NOT EXISTS 'knowledge_artifact';
ALTER TYPE "activity_subject" ADD VALUE IF NOT EXISTS 'import_batch';

CREATE TYPE "milestone_status" AS ENUM ('planned', 'in_progress', 'completed', 'cancelled', 'archived');
CREATE TYPE "artifact_type" AS ENUM ('legacy_document', 'git_reference', 'research', 'specification', 'decision', 'evaluation', 'handoff', 'project_state', 'roadmap', 'agent_instructions');
CREATE TYPE "artifact_origin" AS ENUM ('legacy_source', 'native', 'git_backed');
CREATE TYPE "artifact_canonicality" AS ENUM ('candidate', 'canonical', 'superseded', 'rejected');
CREATE TYPE "artifact_verification" AS ENUM ('unverified', 'verified');
CREATE TYPE "import_batch_status" AS ENUM ('planned', 'applying', 'interrupted', 'completed', 'failed', 'rolling_back', 'rolled_back');
CREATE TYPE "import_mapping_status" AS ENUM ('created', 'matched', 'skipped', 'deferred', 'review_required', 'failed', 'drift', 'rolled_back');
CREATE TYPE "import_conflict_status" AS ENUM ('open', 'resolved', 'deferred');
CREATE TYPE "import_conflict_severity" AS ENUM ('blocking', 'prerequisite', 'review', 'warning');

CREATE TABLE "milestones" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "project_id" uuid NOT NULL REFERENCES "projects"("id"),
  "flow_id" uuid REFERENCES "flows"("id"),
  "name" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "status" "milestone_status" NOT NULL DEFAULT 'planned',
  "target_date" date,
  "completed_at" timestamp with time zone,
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamp with time zone,
  "deleted_by_user_id" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "milestone_project_name_unique" ON "milestones" USING btree ("project_id", "name");
CREATE INDEX "milestone_workspace_status_index" ON "milestones" USING btree ("workspace_id", "status");
CREATE INDEX "milestone_flow_index" ON "milestones" USING btree ("flow_id");

CREATE TABLE "milestone_tasks" (
  "milestone_id" uuid NOT NULL REFERENCES "milestones"("id"),
  "task_id" uuid NOT NULL REFERENCES "tasks"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "milestone_task_unique" ON "milestone_tasks" USING btree ("milestone_id", "task_id");
CREATE INDEX "milestone_tasks_task_index" ON "milestone_tasks" USING btree ("task_id");

CREATE TABLE "knowledge_artifacts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "project_id" uuid REFERENCES "projects"("id"),
  "flow_id" uuid REFERENCES "flows"("id"),
  "task_id" uuid REFERENCES "tasks"("id"),
  "type" "artifact_type" NOT NULL,
  "origin" "artifact_origin" NOT NULL,
  "canonicality" "artifact_canonicality" NOT NULL DEFAULT 'candidate',
  "verification" "artifact_verification" NOT NULL DEFAULT 'unverified',
  "title" text NOT NULL,
  "summary" text NOT NULL DEFAULT '',
  "current_revision_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamp with time zone,
  "deleted_by_user_id" uuid REFERENCES "users"("id"),
  "created_by_user_id" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX "knowledge_artifact_workspace_type_index" ON "knowledge_artifacts" USING btree ("workspace_id", "type");
CREATE INDEX "knowledge_artifact_project_index" ON "knowledge_artifacts" USING btree ("project_id");
CREATE INDEX "knowledge_artifact_flow_index" ON "knowledge_artifacts" USING btree ("flow_id");
CREATE INDEX "knowledge_artifact_task_index" ON "knowledge_artifacts" USING btree ("task_id");

CREATE TABLE "knowledge_artifact_revisions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "artifact_id" uuid NOT NULL REFERENCES "knowledge_artifacts"("id"),
  "revision" integer NOT NULL,
  "native_content" text,
  "content_hash" text,
  "imported_at" timestamp with time zone,
  "created_by_user_id" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "knowledge_artifact_revision_unique" ON "knowledge_artifact_revisions" USING btree ("artifact_id", "revision");
CREATE INDEX "knowledge_artifact_revision_workspace_index" ON "knowledge_artifact_revisions" USING btree ("workspace_id", "artifact_id");

CREATE TABLE "repository_artifact_references" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "artifact_id" uuid NOT NULL REFERENCES "knowledge_artifacts"("id"),
  "github_repository_id" uuid REFERENCES "github_repositories"("id"),
  "repository_full_name" text NOT NULL,
  "path" text NOT NULL,
  "commit_sha" text,
  "content_hash" text,
  "source_project_id" uuid REFERENCES "projects"("id"),
  "verified_at" timestamp with time zone,
  "verification_note" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "repository_artifact_reference_unique" ON "repository_artifact_references" USING btree ("artifact_id", "repository_full_name", "path", "commit_sha");
CREATE INDEX "repository_artifact_reference_repository_index" ON "repository_artifact_references" USING btree ("github_repository_id");
CREATE INDEX "repository_artifact_reference_workspace_index" ON "repository_artifact_references" USING btree ("workspace_id", "repository_full_name");

CREATE TABLE "artifact_relations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "from_artifact_id" uuid NOT NULL REFERENCES "knowledge_artifacts"("id"),
  "to_artifact_id" uuid NOT NULL REFERENCES "knowledge_artifacts"("id"),
  "relation" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "artifact_relation_unique" ON "artifact_relations" USING btree ("from_artifact_id", "to_artifact_id", "relation");
CREATE INDEX "artifact_relation_to_index" ON "artifact_relations" USING btree ("to_artifact_id");

CREATE TABLE "external_sources" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "system" text NOT NULL,
  "bundle_version" text NOT NULL,
  "bundle_checksum" text NOT NULL,
  "source_uri" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "external_source_workspace_bundle_unique" ON "external_sources" USING btree ("workspace_id", "system", "bundle_version", "bundle_checksum");

CREATE TABLE "import_batches" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "external_source_id" uuid NOT NULL REFERENCES "external_sources"("id"),
  "bundle_version" text NOT NULL,
  "bundle_checksum" text NOT NULL,
  "bundle_path_hash" text NOT NULL,
  "status" "import_batch_status" NOT NULL DEFAULT 'planned',
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "actor_user_id" uuid REFERENCES "users"("id"),
  "overrides_hash" text,
  "summary" jsonb NOT NULL DEFAULT '{}',
  "error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX "import_batch_workspace_status_index" ON "import_batches" USING btree ("workspace_id", "status");
CREATE UNIQUE INDEX "import_batch_source_checksum_unique" ON "import_batches" USING btree ("external_source_id", "bundle_checksum");

CREATE TABLE "external_object_mappings" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "external_source_id" uuid NOT NULL REFERENCES "external_sources"("id"),
  "import_batch_id" uuid NOT NULL REFERENCES "import_batches"("id"),
  "source_system" text NOT NULL,
  "source_kind" text NOT NULL,
  "source_id" text NOT NULL,
  "source_key" text NOT NULL,
  "import_key" text NOT NULL,
  "source_url" text,
  "bundle_version" text NOT NULL,
  "source_payload_hash" text NOT NULL,
  "target_entity_type" text NOT NULL,
  "target_entity_id" uuid,
  "status" "import_mapping_status" NOT NULL,
  "created_target" boolean NOT NULL DEFAULT false,
  "imported_at" timestamp with time zone,
  "last_verified_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "external_object_mapping_workspace_source_key_unique" ON "external_object_mappings" USING btree ("workspace_id", "source_key");
CREATE UNIQUE INDEX "external_object_mapping_import_key_unique" ON "external_object_mappings" USING btree ("import_key");
CREATE INDEX "external_object_mapping_batch_index" ON "external_object_mappings" USING btree ("import_batch_id");
CREATE INDEX "external_object_mapping_target_index" ON "external_object_mappings" USING btree ("target_entity_type", "target_entity_id");

CREATE TABLE "import_created_objects" (
  "id" uuid PRIMARY KEY NOT NULL,
  "import_batch_id" uuid NOT NULL REFERENCES "import_batches"("id"),
  "mapping_id" uuid NOT NULL REFERENCES "external_object_mappings"("id"),
  "target_entity_type" text NOT NULL,
  "target_entity_id" uuid NOT NULL,
  "imported_version" integer,
  "imported_content_hash" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "import_created_object_mapping_unique" ON "import_created_objects" USING btree ("mapping_id");
CREATE INDEX "import_created_object_batch_index" ON "import_created_objects" USING btree ("import_batch_id");

CREATE TABLE "import_conflicts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "import_batch_id" uuid NOT NULL REFERENCES "import_batches"("id"),
  "external_mapping_id" uuid REFERENCES "external_object_mappings"("id"),
  "code" text NOT NULL,
  "severity" "import_conflict_severity" NOT NULL,
  "status" "import_conflict_status" NOT NULL DEFAULT 'open',
  "source_key" text,
  "message" text NOT NULL,
  "resolution" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_at" timestamp with time zone
);
CREATE UNIQUE INDEX "import_conflict_batch_code_source_unique" ON "import_conflicts" USING btree ("import_batch_id", "code", "source_key");
CREATE INDEX "import_conflict_batch_status_index" ON "import_conflicts" USING btree ("import_batch_id", "status");

CREATE TABLE "import_verifications" (
  "id" uuid PRIMARY KEY NOT NULL,
  "import_batch_id" uuid NOT NULL REFERENCES "import_batches"("id"),
  "report_path" text NOT NULL,
  "report_checksum" text NOT NULL,
  "result" jsonb NOT NULL,
  "verified_at" timestamp with time zone NOT NULL DEFAULT now(),
  "verified_by_user_id" uuid REFERENCES "users"("id")
);
CREATE UNIQUE INDEX "import_verification_batch_unique" ON "import_verifications" USING btree ("import_batch_id");
