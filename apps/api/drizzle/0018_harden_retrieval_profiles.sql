CREATE TABLE "embedding_profiles" (
	"key" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"model_revision" text NOT NULL,
	"dimensions" integer NOT NULL,
	"max_input_tokens" integer NOT NULL,
	"query_prefix" text DEFAULT '' NOT NULL,
	"document_prefix" text DEFAULT '' NOT NULL,
	"normalized" boolean DEFAULT true NOT NULL,
	"distance_metric" text DEFAULT 'cosine' NOT NULL,
	"storage_lane" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embedding_profiles_dimensions_check" CHECK ("embedding_profiles"."dimensions" BETWEEN 1 AND 2000),
	CONSTRAINT "embedding_profiles_max_input_tokens_check" CHECK ("embedding_profiles"."max_input_tokens" > 0),
	CONSTRAINT "embedding_profiles_distance_metric_check" CHECK ("embedding_profiles"."distance_metric" IN ('cosine', 'inner_product', 'l2'))
);
--> statement-breakpoint
INSERT INTO "embedding_profiles" ("key", "provider", "model", "model_revision", "dimensions", "max_input_tokens", "query_prefix", "document_prefix", "normalized", "distance_metric", "storage_lane")
VALUES ('nomic-v2-768', 'openai-compatible', 'nomic-ai/nomic-embed-text-v2-moe', '1066b6599d099fbb93dfcb64f9c37a7c9e503e85', 768, 512, 'search_query: ', 'search_document: ', true, 'cosine', 'vector-768');
--> statement-breakpoint
ALTER TABLE "retrieval_embeddings" RENAME COLUMN "model" TO "profile_key";--> statement-breakpoint
ALTER TABLE "retrieval_traces" RENAME COLUMN "embedding_model" TO "embedding_profile_key";--> statement-breakpoint
DELETE FROM "retrieval_embeddings";--> statement-breakpoint
UPDATE "retrieval_traces" SET "embedding_profile_key" = NULL;--> statement-breakpoint
DROP INDEX "retrieval_documents_source_unique";--> statement-breakpoint
ALTER TABLE "retrieval_embeddings" DROP CONSTRAINT "retrieval_embeddings_document_id_model_pk";--> statement-breakpoint
ALTER TABLE "retrieval_embeddings" ADD CONSTRAINT "retrieval_embeddings_document_id_profile_key_pk" PRIMARY KEY("document_id","profile_key");--> statement-breakpoint
ALTER TABLE "retrieval_documents" ADD COLUMN "source_part" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "retrieval_documents" ADD COLUMN "embedding_text" text;--> statement-breakpoint
UPDATE "retrieval_documents" SET "embedding_text" = "contextual_prefix" || E'\n' || "title" || E'\n' || "content";--> statement-breakpoint
ALTER TABLE "retrieval_documents" ALTER COLUMN "embedding_text" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "embedding_profiles_active_index" ON "embedding_profiles" USING btree ("active","storage_lane");--> statement-breakpoint
ALTER TABLE "retrieval_embeddings" ADD CONSTRAINT "retrieval_embeddings_profile_key_embedding_profiles_key_fk" FOREIGN KEY ("profile_key") REFERENCES "public"."embedding_profiles"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_traces" ADD CONSTRAINT "retrieval_traces_embedding_profile_key_embedding_profiles_key_fk" FOREIGN KEY ("embedding_profile_key") REFERENCES "public"."embedding_profiles"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "retrieval_documents_source_unique" ON "retrieval_documents" USING btree ("workspace_id","source_type","source_id","source_part");--> statement-breakpoint
ALTER TABLE "retrieval_documents" ADD CONSTRAINT "retrieval_documents_source_part_check" CHECK ("retrieval_documents"."source_part" >= 0);
