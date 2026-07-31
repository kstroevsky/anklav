CREATE TYPE "public"."oauth_token_kind" AS ENUM('access', 'refresh');--> statement-breakpoint
CREATE TABLE "oauth_clients" (
  "id" uuid PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "redirect_uris" jsonb NOT NULL,
  "client_id_issued_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "oauth_authorization_requests" (
  "id" uuid PRIMARY KEY NOT NULL,
  "client_id" uuid NOT NULL,
  "redirect_uri" text NOT NULL,
  "code_challenge" text NOT NULL,
  "scopes" text NOT NULL,
  "state" text,
  "resource" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "oauth_grants" (
  "id" uuid PRIMARY KEY NOT NULL,
  "client_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "scopes" text NOT NULL,
  "revoked_at" timestamp with time zone,
  "last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "oauth_grant_workspaces" (
  "grant_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "oauth_authorization_codes" (
  "id" uuid PRIMARY KEY NOT NULL,
  "code_hash" text NOT NULL,
  "grant_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "redirect_uri" text NOT NULL,
  "code_challenge" text NOT NULL,
  "scopes" text NOT NULL,
  "resource" text NOT NULL,
  "used_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
  "id" uuid PRIMARY KEY NOT NULL,
  "token_hash" text NOT NULL,
  "kind" "oauth_token_kind" NOT NULL,
  "family_id" uuid NOT NULL,
  "grant_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "scopes" text NOT NULL,
  "resource" text NOT NULL,
  "replaced_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "oauth_authorization_requests" ADD CONSTRAINT "oauth_authorization_requests_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grant_workspaces" ADD CONSTRAINT "oauth_grant_workspaces_grant_id_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grant_workspaces" ADD CONSTRAINT "oauth_grant_workspaces_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_grant_id_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_grant_id_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_clients_expires_index" ON "oauth_clients" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "oauth_authorization_requests_expiry_index" ON "oauth_authorization_requests" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "oauth_grants_user_index" ON "oauth_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_grants_client_index" ON "oauth_grants" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_grant_workspace_unique" ON "oauth_grant_workspaces" USING btree ("grant_id","workspace_id");--> statement-breakpoint
CREATE INDEX "oauth_grant_workspaces_workspace_index" ON "oauth_grant_workspaces" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_authorization_codes_hash_unique" ON "oauth_authorization_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "oauth_authorization_codes_expiry_index" ON "oauth_authorization_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_tokens_hash_unique" ON "oauth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "oauth_tokens_grant_index" ON "oauth_tokens" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "oauth_tokens_family_index" ON "oauth_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "oauth_tokens_expiry_index" ON "oauth_tokens" USING btree ("expires_at");
