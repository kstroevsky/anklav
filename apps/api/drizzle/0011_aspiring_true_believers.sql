CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "domain_events_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" uuid NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"aggregate_version" integer NOT NULL,
	"event_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"command_hash" text NOT NULL,
	"actor_user_id" uuid,
	"source" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "domain_events_sequence_unique" ON "domain_events" USING btree ("sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_events_idempotency_unique" ON "domain_events" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_events_aggregate_version_unique" ON "domain_events" USING btree ("aggregate_type","aggregate_id","aggregate_version");--> statement-breakpoint
CREATE INDEX "domain_events_aggregate_sequence_index" ON "domain_events" USING btree ("aggregate_type","aggregate_id","sequence");--> statement-breakpoint
CREATE INDEX "domain_events_workspace_sequence_index" ON "domain_events" USING btree ("workspace_id","sequence");
--> statement-breakpoint
INSERT INTO "domain_events" (
	"id", "workspace_id", "aggregate_type", "aggregate_id", "aggregate_version", "event_type",
	"idempotency_key", "command_hash", "source", "payload", "created_at"
)
SELECT
	"id", "workspace_id", 'task', "id", "version", 'task.backfilled',
	'backfill:task:' || "id"::text || ':v' || "version"::text,
	md5('task.backfilled:' || "id"::text || ':' || "version"::text) || md5('projection:' || "id"::text),
	'{"type":"migration","version":"0011"}'::jsonb,
	jsonb_build_object('state', to_jsonb("tasks"), 'result', to_jsonb("tasks")),
	"created_at"
FROM "tasks";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "require_task_status_domain_event"() RETURNS trigger AS $$
BEGIN
	IF current_setting('anklav.projection_rebuild', true) = 'on' THEN
		RETURN NEW;
	END IF;
	IF NEW."workflow_state_id" IS DISTINCT FROM OLD."workflow_state_id" THEN
		IF NEW."version" <> OLD."version" + 1 THEN
			RAISE EXCEPTION 'task status transitions must increment the aggregate version';
		END IF;
		IF NOT EXISTS (
			SELECT 1 FROM "domain_events"
			WHERE "aggregate_type" = 'task'
				AND "aggregate_id" = NEW."id"
				AND "aggregate_version" = NEW."version"
		) THEN
			RAISE EXCEPTION 'task status transition requires a matching domain event';
		END IF;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "tasks_status_domain_event_required"
AFTER UPDATE ON "tasks"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "require_task_status_domain_event"();
