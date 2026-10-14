CREATE TABLE "alert_thresholds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_kind" text NOT NULL,
	"threshold" double precision,
	"for_seconds" integer NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_thresholds_rule_kind_unique" UNIQUE("rule_kind"),
	CONSTRAINT "alert_thresholds_rule_kind_check" CHECK ("alert_thresholds"."rule_kind" in ('queue', 'cpu', 'port', 'optical', 'offline')),
	CONSTRAINT "alert_thresholds_for_seconds_check" CHECK ("alert_thresholds"."for_seconds" >= 0)
);
--> statement-breakpoint
ALTER TABLE "alert_thresholds" ADD CONSTRAINT "alert_thresholds_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;