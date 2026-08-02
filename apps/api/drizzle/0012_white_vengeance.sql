CREATE TABLE "project_repositories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"role" text DEFAULT 'supporting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text DEFAULT 'git' NOT NULL,
	"provider_repository_id" text,
	"owner" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"remote_url" text DEFAULT '' NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repository_local_aliases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"repository_id" uuid NOT NULL,
	"machine_identity" text NOT NULL,
	"local_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "objective" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "constraints" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "risk_level" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "expected_artifacts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "target_repository_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "target_branch" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "included_paths" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "excluded_paths" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "context_policy" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "memory_mode" text DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "required_approvals" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "coordinating_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "github_repositories" ADD COLUMN "canonical_repository_id" uuid;--> statement-breakpoint
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_local_aliases" ADD CONSTRAINT "repository_local_aliases_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_repositories_unique" ON "project_repositories" USING btree ("project_id","repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_primary_repository_unique" ON "project_repositories" USING btree ("project_id") WHERE "project_repositories"."role" = 'primary';--> statement-breakpoint
CREATE INDEX "project_repositories_repository_index" ON "project_repositories" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_workspace_full_name_unique" ON "repositories" USING btree ("workspace_id","full_name");--> statement-breakpoint
CREATE INDEX "repositories_workspace_index" ON "repositories" USING btree ("workspace_id","archived");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_local_alias_machine_path_unique" ON "repository_local_aliases" USING btree ("machine_identity","local_path");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_local_alias_repository_machine_unique" ON "repository_local_aliases" USING btree ("repository_id","machine_identity");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_target_repository_id_repositories_id_fk" FOREIGN KEY ("target_repository_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_coordinating_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("coordinating_membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_repositories" ADD CONSTRAINT "github_repositories_canonical_repository_id_repositories_id_fk" FOREIGN KEY ("canonical_repository_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_target_repository_index" ON "tasks" USING btree ("target_repository_id");--> statement-breakpoint

INSERT INTO "repositories" ("id", "workspace_id", "provider", "provider_repository_id", "owner", "name", "full_name", "remote_url", "default_branch", "visibility", "archived", "created_at", "updated_at")
SELECT gen_random_uuid(), c."workspace_id", 'github', gr."github_repository_id"::text, gr."owner_login", gr."name", gr."full_name", gr."html_url", gr."default_branch", CASE WHEN gr."private" THEN 'private' ELSE 'public' END, NOT gr."installed", gr."created_at", gr."updated_at"
FROM "github_repositories" gr
JOIN "github_connections" c ON c."id" = gr."connection_id"
ON CONFLICT ("workspace_id", "full_name") DO UPDATE SET
  "provider" = EXCLUDED."provider",
  "provider_repository_id" = EXCLUDED."provider_repository_id",
  "owner" = EXCLUDED."owner",
  "name" = EXCLUDED."name",
  "remote_url" = EXCLUDED."remote_url",
  "default_branch" = EXCLUDED."default_branch",
  "visibility" = EXCLUDED."visibility",
  "archived" = EXCLUDED."archived",
  "updated_at" = EXCLUDED."updated_at";--> statement-breakpoint

UPDATE "github_repositories" gr
SET "canonical_repository_id" = r."id"
FROM "github_connections" c, "repositories" r
WHERE c."id" = gr."connection_id" AND r."workspace_id" = c."workspace_id" AND r."full_name" = gr."full_name";--> statement-breakpoint

INSERT INTO "project_repositories" ("id", "project_id", "repository_id", "role", "created_at")
SELECT gen_random_uuid(), gpr."project_id", gr."canonical_repository_id", CASE WHEN gpr."default_outbound" THEN 'primary' ELSE 'supporting' END, gpr."created_at"
FROM "github_project_repositories" gpr
JOIN "github_repositories" gr ON gr."id" = gpr."repository_id"
WHERE gr."canonical_repository_id" IS NOT NULL
ON CONFLICT ("project_id", "repository_id") DO NOTHING;--> statement-breakpoint

INSERT INTO "repositories" ("id", "workspace_id", "provider", "owner", "name", "full_name")
SELECT gen_random_uuid(), p."workspace_id", 'git', split_part(trim(p."repository_reference"), '/', 1), split_part(trim(p."repository_reference"), '/', 2), trim(p."repository_reference")
FROM "projects" p
WHERE trim(p."repository_reference") ~ '^[^/[:space:]]+/[^/[:space:]]+$'
ON CONFLICT ("workspace_id", "full_name") DO NOTHING;--> statement-breakpoint

INSERT INTO "project_repositories" ("id", "project_id", "repository_id", "role")
SELECT gen_random_uuid(), p."id", r."id", CASE WHEN EXISTS (SELECT 1 FROM "project_repositories" existing WHERE existing."project_id" = p."id") THEN 'supporting' ELSE 'primary' END
FROM "projects" p
JOIN "repositories" r ON r."workspace_id" = p."workspace_id" AND r."full_name" = trim(p."repository_reference")
WHERE trim(p."repository_reference") ~ '^[^/[:space:]]+/[^/[:space:]]+$'
ON CONFLICT ("project_id", "repository_id") DO NOTHING;--> statement-breakpoint

UPDATE "tasks" SET "objective" = CASE WHEN trim("description") <> '' THEN "description" ELSE "title" END WHERE "objective" = '';--> statement-breakpoint

UPDATE "domain_events"
SET "payload" = jsonb_set("payload", '{state}', ("payload"->'state') || jsonb_build_object(
  'objective', COALESCE(NULLIF("payload"->'state'->>'objective', ''), NULLIF("payload"->'state'->>'description', ''), "payload"->'state'->>'title', ''),
  'constraints', COALESCE("payload"->'state'->'constraints', '[]'::jsonb),
  'riskLevel', COALESCE("payload"->'state'->'riskLevel', '"medium"'::jsonb),
  'expectedArtifacts', COALESCE("payload"->'state'->'expectedArtifacts', '[]'::jsonb),
  'targetRepositoryId', COALESCE("payload"->'state'->'targetRepositoryId', 'null'::jsonb),
  'targetBranch', COALESCE("payload"->'state'->'targetBranch', '""'::jsonb),
  'includedPaths', COALESCE("payload"->'state'->'includedPaths', '[]'::jsonb),
  'excludedPaths', COALESCE("payload"->'state'->'excludedPaths', '[]'::jsonb),
  'contextPolicy', COALESCE("payload"->'state'->'contextPolicy', '{}'::jsonb),
  'memoryMode', COALESCE("payload"->'state'->'memoryMode', '"project"'::jsonb),
  'requiredApprovals', COALESCE("payload"->'state'->'requiredApprovals', '[]'::jsonb),
  'coordinatingMembershipId', COALESCE("payload"->'state'->'coordinatingMembershipId', 'null'::jsonb)
))
WHERE "aggregate_type" = 'task';
