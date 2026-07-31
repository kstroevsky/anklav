CREATE TYPE "public"."activity_subject" AS ENUM('workspace', 'membership', 'workflow_state', 'project', 'flow', 'task', 'label', 'comment', 'task_relation', 'flow_relation', 'checklist_item');--> statement-breakpoint
CREATE TYPE "public"."checklist_kind" AS ENUM('readiness', 'acceptance');--> statement-breakpoint
CREATE TYPE "public"."comment_subject" AS ENUM('task', 'flow');--> statement-breakpoint
CREATE TYPE "public"."flow_relation_type" AS ENUM('blocks', 'related', 'replaces', 'merged_into');--> statement-breakpoint
CREATE TYPE "public"."flow_scope" AS ENUM('all_projects', 'selected_projects');--> statement-breakpoint
CREATE TYPE "public"."flow_semantic" AS ENUM('proposed', 'active', 'paused', 'converged', 'closed');--> statement-breakpoint
CREATE TYPE "public"."health" AS ENUM('unknown', 'on_track', 'at_risk', 'off_track');--> statement-breakpoint
CREATE TYPE "public"."instance_role" AS ENUM('user', 'instance_admin');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('none', 'low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('proposed', 'planned', 'active', 'paused', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('not_required', 'pending', 'approved', 'changes_requested');--> statement-breakpoint
CREATE TYPE "public"."task_flow_role" AS ENUM('primary', 'related');--> statement-breakpoint
CREATE TYPE "public"."task_relation_type" AS ENUM('blocks', 'related', 'duplicate_of');--> statement-breakpoint
CREATE TYPE "public"."task_semantic" AS ENUM('inbox', 'planned', 'ready', 'in_progress', 'human_review', 'blocked', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workflow_entity" AS ENUM('task', 'flow');--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "activity_events_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" uuid NOT NULL,
	"subject_type" "activity_subject" NOT NULL,
	"subject_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" "checklist_kind" NOT NULL,
	"text" text NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"subject" "comment_subject" NOT NULL,
	"task_id" uuid,
	"flow_id" uuid,
	"body" text NOT NULL,
	"author_user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "convergence_criteria" (
	"id" uuid PRIMARY KEY NOT NULL,
	"flow_id" uuid NOT NULL,
	"text" text NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_allowed_projects" (
	"flow_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_relations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_flow_id" uuid NOT NULL,
	"target_flow_id" uuid NOT NULL,
	"type" "flow_relation_type" NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"purpose" text DEFAULT '' NOT NULL,
	"workflow_state_id" uuid NOT NULL,
	"priority" "priority" DEFAULT 'none' NOT NULL,
	"health" "health" DEFAULT 'unknown' NOT NULL,
	"current_focus" text DEFAULT '' NOT NULL,
	"current_state_summary" text DEFAULT '' NOT NULL,
	"important_findings" text DEFAULT '' NOT NULL,
	"next_recommended_action" text DEFAULT '' NOT NULL,
	"scope" "flow_scope" DEFAULT 'all_projects' NOT NULL,
	"responsible_membership_id" uuid,
	"primary_current_task_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"label_id" uuid NOT NULL,
	"project_id" uuid,
	"flow_id" uuid,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#64748b' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "project_status" DEFAULT 'proposed' NOT NULL,
	"priority" "priority" DEFAULT 'none' NOT NULL,
	"health" "health" DEFAULT 'unknown' NOT NULL,
	"current_focus" text DEFAULT '' NOT NULL,
	"current_state_summary" text DEFAULT '' NOT NULL,
	"repository_reference" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_flows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"role" "task_flow_role" NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_relations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_task_id" uuid NOT NULL,
	"target_task_id" uuid NOT NULL,
	"type" "task_relation_type" NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"parent_task_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"workflow_state_id" uuid NOT NULL,
	"priority" "priority" DEFAULT 'none' NOT NULL,
	"assignee_membership_id" uuid,
	"due_date" date,
	"human_review_required" boolean DEFAULT false NOT NULL,
	"review_status" "review_status" DEFAULT 'not_required' NOT NULL,
	"reviewer_membership_id" uuid,
	"review_decided_at" timestamp with time zone,
	"review_note" text DEFAULT '' NOT NULL,
	"verification_performed" text DEFAULT '' NOT NULL,
	"completion_evidence" text DEFAULT '' NOT NULL,
	"remaining_limitations" text DEFAULT '' NOT NULL,
	"follow_up_work" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"instance_role" "instance_role" DEFAULT 'user' NOT NULL,
	"theme" text DEFAULT 'system' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_states" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entity_type" "workflow_entity" NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"task_semantic" "task_semantic",
	"flow_semantic" "flow_semantic",
	"position" integer NOT NULL,
	"is_initial" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" DEFAULT 'member' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convergence_criteria" ADD CONSTRAINT "convergence_criteria_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_allowed_projects" ADD CONSTRAINT "flow_allowed_projects_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_allowed_projects" ADD CONSTRAINT "flow_allowed_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_relations" ADD CONSTRAINT "flow_relations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_relations" ADD CONSTRAINT "flow_relations_source_flow_id_flows_id_fk" FOREIGN KEY ("source_flow_id") REFERENCES "public"."flows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_relations" ADD CONSTRAINT "flow_relations_target_flow_id_flows_id_fk" FOREIGN KEY ("target_flow_id") REFERENCES "public"."flows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_relations" ADD CONSTRAINT "flow_relations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_workflow_state_id_workflow_states_id_fk" FOREIGN KEY ("workflow_state_id") REFERENCES "public"."workflow_states"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_responsible_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("responsible_membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_assignments" ADD CONSTRAINT "label_assignments_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_assignments" ADD CONSTRAINT "label_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_assignments" ADD CONSTRAINT "label_assignments_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_assignments" ADD CONSTRAINT "label_assignments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_flows" ADD CONSTRAINT "task_flows_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_flows" ADD CONSTRAINT "task_flows_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_flows" ADD CONSTRAINT "task_flows_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_source_task_id_tasks_id_fk" FOREIGN KEY ("source_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_target_task_id_tasks_id_fk" FOREIGN KEY ("target_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workflow_state_id_workflow_states_id_fk" FOREIGN KEY ("workflow_state_id") REFERENCES "public"."workflow_states"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("assignee_membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reviewer_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("reviewer_membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_states" ADD CONSTRAINT "workflow_states_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_sequence_unique" ON "activity_events" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "activity_workspace_sequence_index" ON "activity_events" USING btree ("workspace_id","sequence");--> statement-breakpoint
CREATE INDEX "comments_task_index" ON "comments" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_flow_index" ON "comments" USING btree ("flow_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "flow_allowed_projects_unique" ON "flow_allowed_projects" USING btree ("flow_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flow_relation_unique" ON "flow_relations" USING btree ("source_flow_id","target_flow_id","type");--> statement-breakpoint
CREATE INDEX "flow_relation_target_index" ON "flow_relations" USING btree ("target_flow_id");--> statement-breakpoint
CREATE INDEX "flows_workspace_state_index" ON "flows" USING btree ("workspace_id","workflow_state_id");--> statement-breakpoint
CREATE INDEX "label_assignments_label_index" ON "label_assignments" USING btree ("label_id");--> statement-breakpoint
CREATE INDEX "label_assignments_task_index" ON "label_assignments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "label_assignments_flow_index" ON "label_assignments" USING btree ("flow_id");--> statement-breakpoint
CREATE INDEX "label_assignments_project_index" ON "label_assignments" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "labels_workspace_name_unique" ON "labels" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "projects_workspace_index" ON "projects" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_index" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_flow_unique" ON "task_flows" USING btree ("task_id","flow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_primary_flow_unique" ON "task_flows" USING btree ("task_id") WHERE "task_flows"."role" = 'primary';--> statement-breakpoint
CREATE INDEX "task_flows_flow_index" ON "task_flows" USING btree ("flow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_relation_unique" ON "task_relations" USING btree ("source_task_id","target_task_id","type");--> statement-breakpoint
CREATE INDEX "task_relation_target_index" ON "task_relations" USING btree ("target_task_id");--> statement-breakpoint
CREATE INDEX "tasks_workspace_state_index" ON "tasks" USING btree ("workspace_id","workflow_state_id");--> statement-breakpoint
CREATE INDEX "tasks_project_index" ON "tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tasks_parent_index" ON "tasks" USING btree ("parent_task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "workflow_state_workspace_entity_index" ON "workflow_states" USING btree ("workspace_id","entity_type","position");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_workspace_user_unique" ON "workspace_memberships" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "membership_user_index" ON "workspace_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_unique" ON "workspaces" USING btree ("slug");
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_exactly_one_subject" CHECK (("subject" = 'task' AND "task_id" IS NOT NULL AND "flow_id" IS NULL) OR ("subject" = 'flow' AND "flow_id" IS NOT NULL AND "task_id" IS NULL));
--> statement-breakpoint
ALTER TABLE "label_assignments" ADD CONSTRAINT "label_assignments_exactly_one_subject" CHECK (num_nonnulls("project_id", "flow_id", "task_id") = 1);
--> statement-breakpoint
ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_not_self" CHECK ("source_task_id" <> "target_task_id");
--> statement-breakpoint
ALTER TABLE "flow_relations" ADD CONSTRAINT "flow_relations_not_self" CHECK ("source_flow_id" <> "target_flow_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION anklav_prevent_activity_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'activity_events are immutable';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER activity_events_immutable BEFORE UPDATE OR DELETE ON "activity_events" FOR EACH ROW EXECUTE FUNCTION anklav_prevent_activity_mutation();
