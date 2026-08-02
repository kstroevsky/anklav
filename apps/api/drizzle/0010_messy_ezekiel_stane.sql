CREATE TABLE "claim_relations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"from_claim_id" uuid NOT NULL,
	"to_claim_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"task_id" uuid,
	"run_id" uuid,
	"subject" text NOT NULL,
	"predicate" text NOT NULL,
	"value" jsonb NOT NULL,
	"classification" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"confidence_basis_points" integer NOT NULL,
	"valid_from_at" timestamp with time zone,
	"valid_until_at" timestamp with time zone,
	"valid_from_commit" text,
	"valid_until_commit" text,
	"source_evidence_artifact_id" uuid,
	"source_knowledge_artifact_id" uuid,
	"source_span" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"extraction" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"superseded_by_claim_id" uuid,
	"resolution_note" text DEFAULT '' NOT NULL,
	"proposed_by_user_id" uuid,
	"verified_by_user_id" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"proposed_by_run_id" uuid,
	"question" text NOT NULL,
	"selected_option" text NOT NULL,
	"rejected_alternatives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rationale" text NOT NULL,
	"consequences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"effective_repository" text,
	"effective_from_commit" text,
	"effective_until_commit" text,
	"evidence_artifact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"superseded_by_decision_id" uuid,
	"resolution_note" text DEFAULT '' NOT NULL,
	"proposed_by_user_id" uuid,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claim_relations" ADD CONSTRAINT "claim_relations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_relations" ADD CONSTRAINT "claim_relations_from_claim_id_memory_claims_id_fk" FOREIGN KEY ("from_claim_id") REFERENCES "public"."memory_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_relations" ADD CONSTRAINT "claim_relations_to_claim_id_memory_claims_id_fk" FOREIGN KEY ("to_claim_id") REFERENCES "public"."memory_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_relations" ADD CONSTRAINT "claim_relations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_claims" ADD CONSTRAINT "memory_claims_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_claims" ADD CONSTRAINT "memory_claims_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_claims" ADD CONSTRAINT "memory_claims_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_claims" ADD CONSTRAINT "memory_claims_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_claims" ADD CONSTRAINT "memory_claims_source_evidence_artifact_id_evidence_artifacts_id_fk" FOREIGN KEY ("source_evidence_artifact_id") REFERENCES "public"."evidence_artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_claims" ADD CONSTRAINT "memory_claims_source_knowledge_artifact_id_knowledge_artifacts_id_fk" FOREIGN KEY ("source_knowledge_artifact_id") REFERENCES "public"."knowledge_artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_claims" ADD CONSTRAINT "memory_claims_proposed_by_user_id_users_id_fk" FOREIGN KEY ("proposed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_claims" ADD CONSTRAINT "memory_claims_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_decisions" ADD CONSTRAINT "project_decisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_decisions" ADD CONSTRAINT "project_decisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_decisions" ADD CONSTRAINT "project_decisions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_decisions" ADD CONSTRAINT "project_decisions_proposed_by_run_id_agent_runs_id_fk" FOREIGN KEY ("proposed_by_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_decisions" ADD CONSTRAINT "project_decisions_proposed_by_user_id_users_id_fk" FOREIGN KEY ("proposed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_decisions" ADD CONSTRAINT "project_decisions_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claim_relations_unique" ON "claim_relations" USING btree ("from_claim_id","to_claim_id","relation");--> statement-breakpoint
CREATE INDEX "claim_relations_to_index" ON "claim_relations" USING btree ("to_claim_id");--> statement-breakpoint
CREATE INDEX "memory_claims_current_project_index" ON "memory_claims" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "memory_claims_task_index" ON "memory_claims" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "memory_claims_subject_index" ON "memory_claims" USING btree ("workspace_id","subject","predicate");--> statement-breakpoint
CREATE INDEX "project_decisions_current_index" ON "project_decisions" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "project_decisions_task_index" ON "project_decisions" USING btree ("task_id");