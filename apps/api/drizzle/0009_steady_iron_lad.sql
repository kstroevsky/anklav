CREATE TABLE "task_leases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"activity" text NOT NULL,
	"write_access" boolean DEFAULT false NOT NULL,
	"exclusive" boolean DEFAULT false NOT NULL,
	"path_scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"machine_identity" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_renewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_leases" ADD CONSTRAINT "task_leases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_leases" ADD CONSTRAINT "task_leases_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_leases" ADD CONSTRAINT "task_leases_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_leases" ADD CONSTRAINT "task_leases_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_leases_task_expiry_index" ON "task_leases" USING btree ("task_id","expires_at");--> statement-breakpoint
CREATE INDEX "task_leases_run_index" ON "task_leases" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "task_leases_workspace_expiry_index" ON "task_leases" USING btree ("workspace_id","expires_at");