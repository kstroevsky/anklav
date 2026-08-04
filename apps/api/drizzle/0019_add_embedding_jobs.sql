CREATE TABLE "retrieval_embedding_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"profile_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retrieval_embedding_jobs_status_check" CHECK ("retrieval_embedding_jobs"."status" IN ('queued', 'running', 'completed', 'dead', 'superseded')),
	CONSTRAINT "retrieval_embedding_jobs_attempts_check" CHECK ("retrieval_embedding_jobs"."attempts" >= 0 AND "retrieval_embedding_jobs"."max_attempts" > 0)
);
--> statement-breakpoint
ALTER TABLE "retrieval_embedding_jobs" ADD CONSTRAINT "retrieval_embedding_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_embedding_jobs" ADD CONSTRAINT "retrieval_embedding_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_embedding_jobs" ADD CONSTRAINT "retrieval_embedding_jobs_document_id_retrieval_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."retrieval_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_embedding_jobs" ADD CONSTRAINT "retrieval_embedding_jobs_profile_key_embedding_profiles_key_fk" FOREIGN KEY ("profile_key") REFERENCES "public"."embedding_profiles"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "retrieval_embedding_jobs_content_unique" ON "retrieval_embedding_jobs" USING btree ("document_id","profile_key","content_hash");--> statement-breakpoint
CREATE INDEX "retrieval_embedding_jobs_claim_index" ON "retrieval_embedding_jobs" USING btree ("status","run_after","created_at");--> statement-breakpoint
CREATE INDEX "retrieval_embedding_jobs_lease_index" ON "retrieval_embedding_jobs" USING btree ("status","locked_at");--> statement-breakpoint
CREATE INDEX "retrieval_embedding_jobs_project_index" ON "retrieval_embedding_jobs" USING btree ("project_id","status");