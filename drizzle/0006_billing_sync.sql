CREATE TABLE "billing_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"trigger" text DEFAULT 'schedule' NOT NULL,
	"error_message" text,
	"invoices_total" integer,
	"matched_exact" integer,
	"matched_normalized" integer,
	"unmatched_unknown" integer,
	"unmatched_duplicate" integer,
	"unmatched_ambiguous" integer,
	"customers_without_invoice" integer,
	"statuses_changed" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_sync_runs_status_check" CHECK ("billing_sync_runs"."status" in ('running', 'success', 'failed')),
	CONSTRAINT "billing_sync_runs_trigger_check" CHECK ("billing_sync_runs"."trigger" in ('schedule', 'manual')),
	CONSTRAINT "billing_sync_runs_finished_check" CHECK (("billing_sync_runs"."status" = 'running') = ("billing_sync_runs"."finished_at" is null)),
	CONSTRAINT "billing_sync_runs_period_check" CHECK ("billing_sync_runs"."finished_at" is null or "billing_sync_runs"."finished_at" >= "billing_sync_runs"."started_at"),
	CONSTRAINT "billing_sync_runs_error_check" CHECK (("billing_sync_runs"."status" = 'failed' and "billing_sync_runs"."error_message" is not null and "billing_sync_runs"."error_message" ~ '[^[:space:]]' and char_length("billing_sync_runs"."error_message") <= 500) or ("billing_sync_runs"."status" <> 'failed' and "billing_sync_runs"."error_message" is null)),
	CONSTRAINT "billing_sync_runs_counts_check" CHECK (("billing_sync_runs"."status" = 'success' and "billing_sync_runs"."invoices_total" is not null and "billing_sync_runs"."matched_exact" is not null and "billing_sync_runs"."matched_normalized" is not null and "billing_sync_runs"."unmatched_unknown" is not null and "billing_sync_runs"."unmatched_duplicate" is not null and "billing_sync_runs"."unmatched_ambiguous" is not null and "billing_sync_runs"."customers_without_invoice" is not null and "billing_sync_runs"."statuses_changed" is not null) or ("billing_sync_runs"."status" <> 'success' and "billing_sync_runs"."invoices_total" is null and "billing_sync_runs"."matched_exact" is null and "billing_sync_runs"."matched_normalized" is null and "billing_sync_runs"."unmatched_unknown" is null and "billing_sync_runs"."unmatched_duplicate" is null and "billing_sync_runs"."unmatched_ambiguous" is null and "billing_sync_runs"."customers_without_invoice" is null and "billing_sync_runs"."statuses_changed" is null)),
	CONSTRAINT "billing_sync_runs_counts_nonnegative_check" CHECK ("billing_sync_runs"."invoices_total" >= 0 and "billing_sync_runs"."matched_exact" >= 0 and "billing_sync_runs"."matched_normalized" >= 0 and "billing_sync_runs"."unmatched_unknown" >= 0 and "billing_sync_runs"."unmatched_duplicate" >= 0 and "billing_sync_runs"."unmatched_ambiguous" >= 0 and "billing_sync_runs"."customers_without_invoice" >= 0 and "billing_sync_runs"."statuses_changed" >= 0),
	CONSTRAINT "billing_sync_runs_total_check" CHECK ("billing_sync_runs"."invoices_total" = "billing_sync_runs"."matched_exact" + "billing_sync_runs"."matched_normalized" + "billing_sync_runs"."unmatched_unknown" + "billing_sync_runs"."unmatched_duplicate" + "billing_sync_runs"."unmatched_ambiguous"),
	CONSTRAINT "billing_sync_runs_changed_check" CHECK ("billing_sync_runs"."statuses_changed" <= "billing_sync_runs"."matched_exact" + "billing_sync_runs"."matched_normalized")
);
--> statement-breakpoint
CREATE TABLE "billing_mismatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"invoice_name" text NOT NULL,
	"invoice_ref" text,
	"invoice_status" text NOT NULL,
	"reason" text NOT NULL,
	"customer_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_mismatches_status_check" CHECK ("billing_mismatches"."invoice_status" in ('lunas', 'isolir')),
	CONSTRAINT "billing_mismatches_reason_check" CHECK ("billing_mismatches"."reason" in ('unknown', 'duplicate', 'ambiguous')),
	CONSTRAINT "billing_mismatches_candidates_check" CHECK (("billing_mismatches"."reason" <> 'unknown' or cardinality("billing_mismatches"."customer_ids") = 0) and ("billing_mismatches"."reason" <> 'duplicate' or cardinality("billing_mismatches"."customer_ids") = 1) and ("billing_mismatches"."reason" <> 'ambiguous' or cardinality("billing_mismatches"."customer_ids") >= 2)),
	CONSTRAINT "billing_mismatches_candidates_null_check" CHECK (array_position("billing_mismatches"."customer_ids", null) is null)
);
--> statement-breakpoint
ALTER TABLE "billing_status" ADD COLUMN "match_kind" text;--> statement-breakpoint
ALTER TABLE "billing_status" ADD COLUMN "billing_name" text;--> statement-breakpoint
ALTER TABLE "billing_status" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "billing_mismatches" ADD CONSTRAINT "billing_mismatches_run_id_billing_sync_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."billing_sync_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_sync_runs_finished_idx" ON "billing_sync_runs" USING btree ("finished_at" DESC NULLS LAST) WHERE "billing_sync_runs"."finished_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_sync_runs_running_unique" ON "billing_sync_runs" USING btree ("status") WHERE "billing_sync_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "billing_mismatches_run_idx" ON "billing_mismatches" USING btree ("run_id");--> statement-breakpoint
ALTER TABLE "billing_status" ADD CONSTRAINT "billing_status_run_id_billing_sync_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."billing_sync_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_status_run_idx" ON "billing_status" USING btree ("run_id");--> statement-breakpoint
ALTER TABLE "billing_status" ADD CONSTRAINT "billing_status_match_kind_check" CHECK ("billing_status"."match_kind" is null or "billing_status"."match_kind" in ('exact', 'normalized'));--> statement-breakpoint
ALTER TABLE "billing_status" ADD CONSTRAINT "billing_status_billing_name_check" CHECK (("billing_status"."match_kind" is null and "billing_status"."billing_name" is null) or ("billing_status"."match_kind" is not null and "billing_status"."billing_name" is not null and char_length("billing_status"."billing_name") > 0));