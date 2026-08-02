CREATE TABLE "evidence_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"task_id" uuid,
	"run_id" uuid,
	"blob_hash" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"type" text NOT NULL,
	"mime_type" text NOT NULL,
	"title" text NOT NULL,
	"producer" text NOT NULL,
	"preview" text DEFAULT '' NOT NULL,
	"redaction_status" text DEFAULT 'unreviewed' NOT NULL,
	"retention_policy" text DEFAULT 'project_default' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_blobs" (
	"hash" text PRIMARY KEY NOT NULL,
	"byte_size" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_event_links" (
	"evidence_artifact_id" uuid NOT NULL,
	"run_event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_event_links_evidence_artifact_id_run_event_id_pk" PRIMARY KEY("evidence_artifact_id","run_event_id")
);
--> statement-breakpoint
ALTER TABLE "run_checkpoints" ADD COLUMN "evidence_artifact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_artifacts" ADD CONSTRAINT "evidence_artifacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_artifacts" ADD CONSTRAINT "evidence_artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_artifacts" ADD CONSTRAINT "evidence_artifacts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_artifacts" ADD CONSTRAINT "evidence_artifacts_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_artifacts" ADD CONSTRAINT "evidence_artifacts_blob_hash_evidence_blobs_hash_fk" FOREIGN KEY ("blob_hash") REFERENCES "public"."evidence_blobs"("hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_artifacts" ADD CONSTRAINT "evidence_artifacts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_event_links" ADD CONSTRAINT "evidence_event_links_evidence_artifact_id_evidence_artifacts_id_fk" FOREIGN KEY ("evidence_artifact_id") REFERENCES "public"."evidence_artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_event_links" ADD CONSTRAINT "evidence_event_links_run_event_id_run_events_id_fk" FOREIGN KEY ("run_event_id") REFERENCES "public"."run_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_artifacts_workspace_idempotency_unique" ON "evidence_artifacts" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "evidence_artifacts_task_index" ON "evidence_artifacts" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "evidence_artifacts_run_index" ON "evidence_artifacts" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "evidence_artifacts_blob_index" ON "evidence_artifacts" USING btree ("blob_hash");--> statement-breakpoint
CREATE INDEX "evidence_event_links_event_index" ON "evidence_event_links" USING btree ("run_event_id");