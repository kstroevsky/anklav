CREATE TABLE "retrieval_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"run_id" uuid,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"contextual_prefix" text NOT NULL,
	"search_text" text NOT NULL,
	"content_hash" text NOT NULL,
	"authority_basis_points" integer NOT NULL,
	"sensitivity" text DEFAULT 'project' NOT NULL,
	"status" text DEFAULT 'current' NOT NULL,
	"valid_from_at" timestamp with time zone,
	"valid_until_at" timestamp with time zone,
	"source_recorded_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrieval_embeddings" (
	"document_id" uuid NOT NULL,
	"model" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retrieval_embeddings_document_id_model_pk" PRIMARY KEY("document_id","model")
);
--> statement-breakpoint
CREATE TABLE "retrieval_traces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"query_hash" text NOT NULL,
	"intent" text NOT NULL,
	"embedding_model" text,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"candidate_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scoring" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"semantic_used" boolean DEFAULT false NOT NULL,
	"requested_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "retrieval_documents" ADD CONSTRAINT "retrieval_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_documents" ADD CONSTRAINT "retrieval_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_documents" ADD CONSTRAINT "retrieval_documents_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_documents" ADD CONSTRAINT "retrieval_documents_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_embeddings" ADD CONSTRAINT "retrieval_embeddings_document_id_retrieval_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."retrieval_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_traces" ADD CONSTRAINT "retrieval_traces_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_traces" ADD CONSTRAINT "retrieval_traces_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_traces" ADD CONSTRAINT "retrieval_traces_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_traces" ADD CONSTRAINT "retrieval_traces_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "retrieval_documents_source_unique" ON "retrieval_documents" USING btree ("workspace_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "retrieval_documents_project_status_index" ON "retrieval_documents" USING btree ("project_id","status","source_type");--> statement-breakpoint
CREATE INDEX "retrieval_documents_task_index" ON "retrieval_documents" USING btree ("task_id","source_type");--> statement-breakpoint
CREATE INDEX "retrieval_documents_search_index" ON "retrieval_documents" USING gin (to_tsvector('simple', "search_text"));--> statement-breakpoint
CREATE INDEX "retrieval_embeddings_cosine_index" ON "retrieval_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "retrieval_traces_workspace_created_index" ON "retrieval_traces" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "retrieval_traces_task_created_index" ON "retrieval_traces" USING btree ("task_id","created_at");