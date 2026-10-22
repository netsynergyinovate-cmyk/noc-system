CREATE TABLE "diagnostic_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"layer" text NOT NULL,
	"metric" text NOT NULL,
	"label" text NOT NULL,
	"value" text,
	"threshold" text,
	"comparator" text,
	"status" text NOT NULL,
	"detail" text NOT NULL,
	"source_ref" text,
	"sampled_at" timestamp with time zone,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnostic_findings_status_check" CHECK ("diagnostic_findings"."status" in ('ok', 'warn', 'fail', 'unchecked'))
);
--> statement-breakpoint
CREATE TABLE "diagnostic_policy" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"trigger_alert" boolean DEFAULT true NOT NULL,
	"trigger_ticket" boolean DEFAULT true NOT NULL,
	"trigger_billing" boolean DEFAULT true NOT NULL,
	"dedupe_minutes" integer DEFAULT 15 NOT NULL,
	"mass_threshold" integer DEFAULT 10 NOT NULL,
	"mass_window_minutes" integer DEFAULT 5 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnostic_policy_single_row_check" CHECK ("diagnostic_policy"."id" = 1),
	CONSTRAINT "diagnostic_policy_ranges_check" CHECK ("diagnostic_policy"."dedupe_minutes" between 1 and 1440 and "diagnostic_policy"."mass_threshold" between 2 and 1000 and "diagnostic_policy"."mass_window_minutes" between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "diagnostic_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"router_id" uuid,
	"trigger_mode" text NOT NULL,
	"triggered_by" text,
	"triggered_by_user_id" text,
	"trigger_reason" text NOT NULL,
	"trigger_source_ref" text,
	"dedupe_key" text,
	"merged_count" integer DEFAULT 0 NOT NULL,
	"last_merged_at" timestamp with time zone,
	"priority" smallint NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"verdict_layer" text,
	"verdict_detail" text,
	"is_shared_fault" boolean DEFAULT false NOT NULL,
	CONSTRAINT "diagnostic_runs_trigger_mode_check" CHECK ("diagnostic_runs"."trigger_mode" in ('manual', 'auto')),
	CONSTRAINT "diagnostic_runs_status_check" CHECK ("diagnostic_runs"."status" in ('queued', 'running', 'done', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "diagnostic_findings" ADD CONSTRAINT "diagnostic_findings_run_id_diagnostic_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."diagnostic_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_runs" ADD CONSTRAINT "diagnostic_runs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_runs" ADD CONSTRAINT "diagnostic_runs_router_id_routers_id_fk" FOREIGN KEY ("router_id") REFERENCES "public"."routers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diagnostic_findings_run_idx" ON "diagnostic_findings" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "diagnostic_runs_customer_idx" ON "diagnostic_runs" USING btree ("customer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "diagnostic_runs_created_idx" ON "diagnostic_runs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "diagnostic_runs_dedupe_unique" ON "diagnostic_runs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "diagnostic_runs_manual_active_unique" ON "diagnostic_runs" USING btree ("customer_id") WHERE "diagnostic_runs"."trigger_mode" = 'manual' and "diagnostic_runs"."status" in ('queued', 'running');--> statement-breakpoint
INSERT INTO "diagnostic_policy" ("id") VALUES (1) ON CONFLICT DO NOTHING;