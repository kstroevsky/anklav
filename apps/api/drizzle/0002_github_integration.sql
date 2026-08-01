ALTER TABLE "projects" ADD COLUMN "issue_key" text;
ALTER TABLE "tasks" ADD COLUMN "task_number" integer;
ALTER TABLE "tasks" ADD COLUMN "identifier" text;

WITH project_keys AS (
  SELECT id, workspace_id,
    LEFT(COALESCE(NULLIF(UPPER(REGEXP_REPLACE(name, '[^A-Za-z0-9]+', '', 'g')), ''), 'PROJ'), 8) AS base_key,
    ROW_NUMBER() OVER (PARTITION BY workspace_id, LEFT(COALESCE(NULLIF(UPPER(REGEXP_REPLACE(name, '[^A-Za-z0-9]+', '', 'g')), ''), 'PROJ'), 8) ORDER BY created_at, id) AS duplicate_number
  FROM projects
)
UPDATE projects SET issue_key = CASE WHEN project_keys.duplicate_number = 1 THEN project_keys.base_key ELSE LEFT(project_keys.base_key, 6) || project_keys.duplicate_number::text END
FROM project_keys WHERE projects.id = project_keys.id;

WITH numbered_tasks AS (
  SELECT id, project_id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at, id)::integer AS task_number
  FROM tasks
)
UPDATE tasks SET task_number = numbered_tasks.task_number FROM numbered_tasks WHERE tasks.id = numbered_tasks.id;

UPDATE tasks SET identifier = projects.issue_key || '-' || tasks.task_number::text FROM projects WHERE tasks.project_id = projects.id;

ALTER TABLE "projects" ALTER COLUMN "issue_key" SET NOT NULL;
ALTER TABLE "tasks" ALTER COLUMN "task_number" SET NOT NULL;
ALTER TABLE "tasks" ALTER COLUMN "identifier" SET NOT NULL;
CREATE UNIQUE INDEX "projects_workspace_issue_key_unique" ON "projects" USING btree ("workspace_id", "issue_key");
CREATE UNIQUE INDEX "tasks_workspace_identifier_unique" ON "tasks" USING btree ("workspace_id", "identifier");
CREATE UNIQUE INDEX "tasks_project_number_unique" ON "tasks" USING btree ("project_id", "task_number");

CREATE TABLE "project_task_counters" (
  "project_id" uuid PRIMARY KEY NOT NULL REFERENCES "projects"("id"),
  "next_number" integer NOT NULL DEFAULT 1,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
INSERT INTO "project_task_counters" ("project_id", "next_number")
SELECT id, COALESCE((SELECT MAX(task_number) + 1 FROM tasks WHERE tasks.project_id = projects.id), 1) FROM projects;

CREATE TABLE "task_identifier_aliases" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "task_id" uuid NOT NULL REFERENCES "tasks"("id"),
  "identifier" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "task_identifier_alias_workspace_unique" ON "task_identifier_aliases" USING btree ("workspace_id", "identifier");
CREATE INDEX "task_identifier_alias_task_index" ON "task_identifier_aliases" USING btree ("task_id");

CREATE TABLE "github_connections" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "organization_login" text,
  "installation_id" bigint,
  "app_id" bigint,
  "client_id" text,
  "encrypted_credentials" text,
  "status" text NOT NULL DEFAULT 'disconnected',
  "linkbacks_enabled" boolean NOT NULL DEFAULT false,
  "branch_template" text NOT NULL DEFAULT '{identifier}-{slug}',
  "last_webhook_at" timestamp with time zone,
  "last_reconciled_at" timestamp with time zone,
  "last_error" text,
  "created_by_user_id" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "github_connections_workspace_unique" ON "github_connections" USING btree ("workspace_id");

CREATE TABLE "github_oauth_states" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "user_id" uuid REFERENCES "users"("id"),
  "purpose" text NOT NULL,
  "state_hash" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "used_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "github_oauth_state_hash_unique" ON "github_oauth_states" USING btree ("state_hash");
CREATE INDEX "github_oauth_state_expiry_index" ON "github_oauth_states" USING btree ("expires_at");

CREATE TABLE "github_user_connections" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "github_user_id" bigint NOT NULL,
  "login" text NOT NULL,
  "avatar_url" text NOT NULL DEFAULT '',
  "encrypted_token" text NOT NULL,
  "token_expires_at" timestamp with time zone,
  "encrypted_refresh_token" text,
  "refresh_token_expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "github_user_connection_workspace_user_unique" ON "github_user_connections" USING btree ("workspace_id", "user_id");
CREATE UNIQUE INDEX "github_user_connection_workspace_github_unique" ON "github_user_connections" USING btree ("workspace_id", "github_user_id");

CREATE TABLE "github_repositories" (
  "id" uuid PRIMARY KEY NOT NULL,
  "connection_id" uuid NOT NULL REFERENCES "github_connections"("id"),
  "github_repository_id" bigint NOT NULL,
  "node_id" text NOT NULL,
  "owner_login" text NOT NULL,
  "name" text NOT NULL,
  "full_name" text NOT NULL,
  "html_url" text NOT NULL,
  "default_branch" text NOT NULL DEFAULT 'main',
  "private" boolean NOT NULL DEFAULT true,
  "installed" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "github_repository_connection_github_unique" ON "github_repositories" USING btree ("connection_id", "github_repository_id");
CREATE UNIQUE INDEX "github_repository_connection_full_name_unique" ON "github_repositories" USING btree ("connection_id", "full_name");

CREATE TABLE "github_project_repositories" (
  "id" uuid PRIMARY KEY NOT NULL,
  "repository_id" uuid NOT NULL REFERENCES "github_repositories"("id"),
  "project_id" uuid NOT NULL REFERENCES "projects"("id"),
  "sync_mode" text NOT NULL DEFAULT 'none',
  "default_inbound" boolean NOT NULL DEFAULT false,
  "default_outbound" boolean NOT NULL DEFAULT false,
  "open_state_id" uuid REFERENCES "workflow_states"("id"),
  "closed_state_id" uuid REFERENCES "workflow_states"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "github_project_repository_unique" ON "github_project_repositories" USING btree ("repository_id", "project_id");
CREATE INDEX "github_project_repositories_project_index" ON "github_project_repositories" USING btree ("project_id");
CREATE UNIQUE INDEX "github_repository_default_inbound_unique" ON "github_project_repositories" USING btree ("repository_id") WHERE "default_inbound" = true;
CREATE UNIQUE INDEX "github_project_default_outbound_unique" ON "github_project_repositories" USING btree ("project_id") WHERE "default_outbound" = true;

CREATE TABLE "github_issue_links" (
  "id" uuid PRIMARY KEY NOT NULL,
  "task_id" uuid NOT NULL REFERENCES "tasks"("id"),
  "repository_id" uuid NOT NULL REFERENCES "github_repositories"("id"),
  "github_issue_id" bigint NOT NULL,
  "node_id" text NOT NULL,
  "issue_number" integer NOT NULL,
  "html_url" text NOT NULL,
  "sync_mode" text NOT NULL DEFAULT 'manual',
  "sync_status" text NOT NULL DEFAULT 'pending',
  "last_synced_snapshot" jsonb NOT NULL DEFAULT '{}',
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "github_issue_link_task_repository_unique" ON "github_issue_links" USING btree ("task_id", "repository_id");
CREATE UNIQUE INDEX "github_issue_link_repository_issue_unique" ON "github_issue_links" USING btree ("repository_id", "github_issue_id");
CREATE INDEX "github_issue_links_task_index" ON "github_issue_links" USING btree ("task_id");

CREATE TABLE "github_pull_requests" (
  "id" uuid PRIMARY KEY NOT NULL,
  "repository_id" uuid NOT NULL REFERENCES "github_repositories"("id"),
  "github_pull_request_id" bigint NOT NULL,
  "node_id" text NOT NULL,
  "number" integer NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL DEFAULT '',
  "html_url" text NOT NULL,
  "state" text NOT NULL,
  "draft" boolean NOT NULL DEFAULT false,
  "head_ref" text NOT NULL DEFAULT '',
  "base_ref" text NOT NULL DEFAULT '',
  "head_sha" text NOT NULL DEFAULT '',
  "author_login" text NOT NULL DEFAULT '',
  "author_github_user_id" bigint,
  "review_decision" text,
  "mergeable_state" text,
  "checks" jsonb NOT NULL DEFAULT '[]',
  "updated_at_github" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "github_pull_request_repository_github_unique" ON "github_pull_requests" USING btree ("repository_id", "github_pull_request_id");
CREATE UNIQUE INDEX "github_pull_request_repository_number_unique" ON "github_pull_requests" USING btree ("repository_id", "number");
CREATE INDEX "github_pull_requests_repository_state_index" ON "github_pull_requests" USING btree ("repository_id", "state");

CREATE TABLE "github_task_pull_requests" (
  "id" uuid PRIMARY KEY NOT NULL,
  "task_id" uuid NOT NULL REFERENCES "tasks"("id"),
  "pull_request_id" uuid NOT NULL REFERENCES "github_pull_requests"("id"),
  "link_kind" text NOT NULL DEFAULT 'closing',
  "source" text NOT NULL DEFAULT 'manual',
  "ignored" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "github_task_pull_request_unique" ON "github_task_pull_requests" USING btree ("task_id", "pull_request_id");
CREATE INDEX "github_task_pull_requests_task_index" ON "github_task_pull_requests" USING btree ("task_id");

CREATE TABLE "github_webhook_deliveries" (
  "id" uuid PRIMARY KEY NOT NULL,
  "connection_id" uuid REFERENCES "github_connections"("id"),
  "delivery_id" text NOT NULL,
  "event" text NOT NULL,
  "payload" jsonb NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone,
  "error" text
);
CREATE UNIQUE INDEX "github_webhook_delivery_unique" ON "github_webhook_deliveries" USING btree ("delivery_id");
CREATE INDEX "github_webhook_deliveries_process_index" ON "github_webhook_deliveries" USING btree ("processed_at");

CREATE TABLE "integration_jobs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "connection_id" uuid REFERENCES "github_connections"("id"),
  "type" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}',
  "status" text NOT NULL DEFAULT 'queued',
  "attempts" integer NOT NULL DEFAULT 0,
  "run_after" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "integration_jobs_claim_index" ON "integration_jobs" USING btree ("status", "run_after");
CREATE INDEX "integration_jobs_workspace_index" ON "integration_jobs" USING btree ("workspace_id");

CREATE TABLE "notifications" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "type" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL DEFAULT '',
  "href" text NOT NULL DEFAULT '',
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "notifications_user_unread_index" ON "notifications" USING btree ("user_id", "read_at", "created_at");
