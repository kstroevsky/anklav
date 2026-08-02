CREATE TABLE "git_slice_evidence" (
	"git_slice_id" uuid NOT NULL,
	"evidence_artifact_id" uuid NOT NULL,
	"role" text DEFAULT 'dirty_patch' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "git_slice_evidence_git_slice_id_evidence_artifact_id_pk" PRIMARY KEY("git_slice_id","evidence_artifact_id")
);
--> statement-breakpoint
ALTER TABLE "git_slice_evidence" ADD CONSTRAINT "git_slice_evidence_git_slice_id_git_slices_id_fk" FOREIGN KEY ("git_slice_id") REFERENCES "public"."git_slices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_slice_evidence" ADD CONSTRAINT "git_slice_evidence_evidence_artifact_id_evidence_artifacts_id_fk" FOREIGN KEY ("evidence_artifact_id") REFERENCES "public"."evidence_artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "git_slice_evidence_artifact_index" ON "git_slice_evidence" USING btree ("evidence_artifact_id");