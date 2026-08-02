CREATE TABLE "native_session_ingestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"native_session_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"source_revision" text NOT NULL,
	"parser_version" text NOT NULL,
	"from_cursor" text,
	"to_cursor" text,
	"status" text NOT NULL,
	"turn_count" integer DEFAULT 0 NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "native_session_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"native_session_id" uuid NOT NULL,
	"turn_id" uuid,
	"native_item_id" text NOT NULL,
	"parent_native_item_id" text,
	"related_item_id" uuid,
	"relationship_type" text,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'complete' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"redacted_content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"redaction_status" text DEFAULT 'unreviewed' NOT NULL,
	"correlation_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "native_session_turns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"native_session_id" uuid NOT NULL,
	"native_turn_id" text NOT NULL,
	"parent_native_turn_id" text,
	"sequence" integer NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "native_session_evidence" (
	"native_session_id" uuid NOT NULL,
	"evidence_artifact_id" uuid NOT NULL,
	"role" text DEFAULT 'archive' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "native_session_evidence_native_session_id_evidence_artifact_id_pk" PRIMARY KEY("native_session_id","evidence_artifact_id")
);
--> statement-breakpoint
ALTER TABLE "native_sessions" ADD COLUMN "source_kind" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "native_sessions" ADD COLUMN "parser_version" text;--> statement-breakpoint
ALTER TABLE "native_sessions" ADD COLUMN "source_revision" text;--> statement-breakpoint
ALTER TABLE "native_sessions" ADD COLUMN "ingestion_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "native_sessions" ADD COLUMN "last_native_cursor" text;--> statement-breakpoint
ALTER TABLE "native_sessions" ADD COLUMN "last_ingested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "native_sessions" ADD COLUMN "record_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "native_sessions" ADD COLUMN "manifest" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "native_sessions" ADD COLUMN "path_mappings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "native_sessions" ADD COLUMN "parse_errors" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "native_sessions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "native_session_ingestions" ADD CONSTRAINT "native_session_ingestions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_session_ingestions" ADD CONSTRAINT "native_session_ingestions_native_session_id_native_sessions_id_fk" FOREIGN KEY ("native_session_id") REFERENCES "public"."native_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_session_items" ADD CONSTRAINT "native_session_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_session_items" ADD CONSTRAINT "native_session_items_native_session_id_native_sessions_id_fk" FOREIGN KEY ("native_session_id") REFERENCES "public"."native_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_session_items" ADD CONSTRAINT "native_session_items_turn_id_native_session_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."native_session_turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_session_items" ADD CONSTRAINT "native_session_items_related_item_fk" FOREIGN KEY ("related_item_id") REFERENCES "public"."native_session_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_session_turns" ADD CONSTRAINT "native_session_turns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_session_turns" ADD CONSTRAINT "native_session_turns_native_session_id_native_sessions_id_fk" FOREIGN KEY ("native_session_id") REFERENCES "public"."native_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_session_evidence" ADD CONSTRAINT "native_session_evidence_native_session_id_native_sessions_id_fk" FOREIGN KEY ("native_session_id") REFERENCES "public"."native_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_session_evidence" ADD CONSTRAINT "native_session_evidence_evidence_artifact_id_evidence_artifacts_id_fk" FOREIGN KEY ("evidence_artifact_id") REFERENCES "public"."evidence_artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "native_session_ingestions_workspace_idempotency_unique" ON "native_session_ingestions" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "native_session_ingestions_revision_unique" ON "native_session_ingestions" USING btree ("native_session_id","source_revision");--> statement-breakpoint
CREATE INDEX "native_session_ingestions_session_index" ON "native_session_ingestions" USING btree ("native_session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "native_session_items_native_unique" ON "native_session_items" USING btree ("native_session_id","native_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "native_session_items_sequence_unique" ON "native_session_items" USING btree ("native_session_id","sequence");--> statement-breakpoint
CREATE INDEX "native_session_items_session_index" ON "native_session_items" USING btree ("native_session_id","sequence");--> statement-breakpoint
CREATE INDEX "native_session_items_turn_index" ON "native_session_items" USING btree ("turn_id","sequence");--> statement-breakpoint
CREATE INDEX "native_session_items_correlation_index" ON "native_session_items" USING btree ("native_session_id","correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "native_session_turns_native_unique" ON "native_session_turns" USING btree ("native_session_id","native_turn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "native_session_turns_sequence_unique" ON "native_session_turns" USING btree ("native_session_id","sequence");--> statement-breakpoint
CREATE INDEX "native_session_turns_session_index" ON "native_session_turns" USING btree ("native_session_id","sequence");--> statement-breakpoint
CREATE INDEX "native_session_evidence_artifact_index" ON "native_session_evidence" USING btree ("evidence_artifact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "native_sessions_workspace_native_unique" ON "native_sessions" USING btree ("workspace_id","provider","native_session_id");