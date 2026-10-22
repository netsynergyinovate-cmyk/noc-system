CREATE TABLE "syslog_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"router_id" uuid NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"facility" smallint,
	"severity" smallint,
	"topics" text DEFAULT '' NOT NULL,
	"message" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diagnostic_runs" ADD COLUMN "complaint_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "diagnostic_runs" ADD COLUMN "timeline" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "syslog_events" ADD CONSTRAINT "syslog_events_router_id_routers_id_fk" FOREIGN KEY ("router_id") REFERENCES "public"."routers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "syslog_events_router_time_idx" ON "syslog_events" USING btree ("router_id","received_at" DESC NULLS LAST);