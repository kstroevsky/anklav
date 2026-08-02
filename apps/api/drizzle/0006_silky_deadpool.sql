CREATE TYPE "public"."git_slice_dirty_state" AS ENUM('clean', 'dirty_captured', 'dirty_missing', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."native_session_resumability" AS ENUM('unknown', 'resumable', 'requires_reconciliation', 'not_resumable');--> statement-breakpoint
CREATE TYPE "public"."run_provider" AS ENUM('claude', 'codex', 'human', 'other');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'completed', 'failed', 'blocked', 'cancelled');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"parent_run_id" uuid,
	"provider" "run_provider" NOT NULL,
	"client" text NOT NULL,
	"agent_type" text DEFAULT 'general' NOT NULL,
	"model" text,
	"reasoning_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"machine_identity" text NOT NULL,
	"modifies_code" boolean DEFAULT false NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"outcome_summary" text DEFAULT '' NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"token_usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_micros" bigint,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "git_slices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"run_id" uuid,
	"phase" text NOT NULL,
	"github_repository_id" uuid,
	"repository_full_name" text NOT NULL,
	"base_commit_sha" text NOT NULL,
	"head_commit_sha" text NOT NULL,
	"merge_base_sha" text,
	"branch_name" text,
	"included_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excluded_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"diff_hash" text,
	"worktree_identity" text,
	"dirty_state" "git_slice_dirty_state" DEFAULT 'unknown' NOT NULL,
	"patch_artifact_id" uuid,
	"submodule_states" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dependency_lock_hashes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "native_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"provider" "run_provider" NOT NULL,
	"native_session_id" text NOT NULL,
	"parent_native_session_id" text,
	"client_version" text,
	"protocol_version" text,
	"archive_artifact_id" uuid,
	"resumability" "native_session_resumability" DEFAULT 'unknown' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "run_events_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"artifact_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_checkpoints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"git_slice_id" uuid,
	"objective" text NOT NULL,
	"summary" text NOT NULL,
	"completed_work" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"remaining_work" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active_decision_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"relevant_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_verified" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"next_action" text NOT NULL,
	"artifact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"covered_event_sequence_start" bigint,
	"covered_event_sequence_end" bigint,
	"context_pack_hash" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_slices" ADD CONSTRAINT "git_slices_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_slices" ADD CONSTRAINT "git_slices_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_slices" ADD CONSTRAINT "git_slices_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_slices" ADD CONSTRAINT "git_slices_github_repository_id_github_repositories_id_fk" FOREIGN KEY ("github_repository_id") REFERENCES "public"."github_repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_slices" ADD CONSTRAINT "git_slices_patch_artifact_id_knowledge_artifacts_id_fk" FOREIGN KEY ("patch_artifact_id") REFERENCES "public"."knowledge_artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_slices" ADD CONSTRAINT "git_slices_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_sessions" ADD CONSTRAINT "native_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_sessions" ADD CONSTRAINT "native_sessions_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_sessions" ADD CONSTRAINT "native_sessions_archive_artifact_id_knowledge_artifacts_id_fk" FOREIGN KEY ("archive_artifact_id") REFERENCES "public"."knowledge_artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_artifact_id_knowledge_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."knowledge_artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_checkpoints" ADD CONSTRAINT "run_checkpoints_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_checkpoints" ADD CONSTRAINT "run_checkpoints_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_checkpoints" ADD CONSTRAINT "run_checkpoints_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_checkpoints" ADD CONSTRAINT "run_checkpoints_git_slice_id_git_slices_id_fk" FOREIGN KEY ("git_slice_id") REFERENCES "public"."git_slices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_checkpoints" ADD CONSTRAINT "run_checkpoints_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_task_started_index" ON "agent_runs" USING btree ("task_id","started_at");--> statement-breakpoint
CREATE INDEX "agent_runs_workspace_status_index" ON "agent_runs" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "agent_runs_parent_index" ON "agent_runs" USING btree ("parent_run_id");--> statement-breakpoint
CREATE INDEX "git_slices_task_index" ON "git_slices" USING btree ("task_id","captured_at");--> statement-breakpoint
CREATE INDEX "git_slices_run_phase_index" ON "git_slices" USING btree ("run_id","phase");--> statement-breakpoint
CREATE INDEX "native_sessions_run_index" ON "native_sessions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "native_sessions_lookup_index" ON "native_sessions" USING btree ("provider","native_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_workspace_idempotency_unique" ON "run_events" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_sequence_unique" ON "run_events" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "run_events_run_sequence_index" ON "run_events" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "run_checkpoints_run_sequence_unique" ON "run_checkpoints" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "run_checkpoints_task_created_index" ON "run_checkpoints" USING btree ("task_id","created_at");
