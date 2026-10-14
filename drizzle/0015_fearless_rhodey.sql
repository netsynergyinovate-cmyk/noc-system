CREATE SCHEMA IF NOT EXISTS "drizzle";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"hash" text NOT NULL,
	"created_at" bigint,
	"tag" text,
	"duration_ms" integer,
	"applied_by" text,
	"statements_count" integer
);
--> statement-breakpoint
CREATE TABLE "data_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module" text NOT NULL,
	"sync_type" text NOT NULL,
	"direction" text NOT NULL,
	"status" text NOT NULL,
	"records_processed" integer DEFAULT 0 NOT NULL,
	"records_inserted" integer DEFAULT 0 NOT NULL,
	"records_updated" integer DEFAULT 0 NOT NULL,
	"records_skipped" integer DEFAULT 0 NOT NULL,
	"checksum" text,
	"duration_ms" integer DEFAULT 0,
	"actor" text DEFAULT 'system',
	"summary_message" text,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "seed_tracking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seed_key" text NOT NULL,
	"category" text NOT NULL,
	"target_table" text NOT NULL,
	"records_count" integer DEFAULT 0 NOT NULL,
	"checksum" text NOT NULL,
	"is_idempotent" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'seeded' NOT NULL,
	"seeded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"details" text,
	CONSTRAINT "seed_tracking_seed_key_unique" UNIQUE("seed_key")
);
--> statement-breakpoint
CREATE TABLE "onboarding_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"step_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'tertunda' NOT NULL,
	"completed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"step_number" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"target_url" text NOT NULL,
	"target_label" text NOT NULL,
	"prerequisite_step_ids" text[] DEFAULT '{}' NOT NULL,
	"estimated_minutes" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_step_id_onboarding_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."onboarding_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_sync_runs_module_idx" ON "data_sync_runs" USING btree ("module");--> statement-breakpoint
CREATE INDEX "data_sync_runs_status_idx" ON "data_sync_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "data_sync_runs_started_at_idx" ON "data_sync_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "seed_tracking_category_idx" ON "seed_tracking" USING btree ("category");--> statement-breakpoint
CREATE INDEX "seed_tracking_status_idx" ON "seed_tracking" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_progress_user_step_idx" ON "onboarding_progress" USING btree ("user_id","step_id");--> statement-breakpoint
CREATE INDEX "onboarding_progress_status_idx" ON "onboarding_progress" USING btree ("status");--> statement-breakpoint
CREATE INDEX "onboarding_progress_step_idx" ON "onboarding_progress" USING btree ("step_id");--> statement-breakpoint
CREATE INDEX "onboarding_steps_number_idx" ON "onboarding_steps" USING btree ("step_number");--> statement-breakpoint
CREATE INDEX "onboarding_steps_type_idx" ON "onboarding_steps" USING btree ("type");