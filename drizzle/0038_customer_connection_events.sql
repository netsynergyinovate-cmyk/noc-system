CREATE TABLE "customer_connection_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'live' NOT NULL,
	CONSTRAINT "customer_connection_events_kind_check" CHECK ("customer_connection_events"."kind" in ('up', 'down')),
	CONSTRAINT "customer_connection_events_source_check" CHECK ("customer_connection_events"."source" in ('live', 'alert'))
);
--> statement-breakpoint
ALTER TABLE "customer_connection_events" ADD CONSTRAINT "customer_connection_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_connection_events_customer_time_idx" ON "customer_connection_events" USING btree ("customer_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "customer_connection_events_time_idx" ON "customer_connection_events" USING btree ("occurred_at");--> statement-breakpoint
-- Riwayat awal dari alert "offline" yang sudah ada: down = started_at, up = ended_at.
INSERT INTO "customer_connection_events" ("customer_id", "kind", "occurred_at", "source")
SELECT "customer_id", 'down', "started_at", 'alert' FROM "alerts"
WHERE "type" = 'offline' AND "customer_id" IS NOT NULL
UNION ALL
SELECT "customer_id", 'up', "ended_at", 'alert' FROM "alerts"
WHERE "type" = 'offline' AND "customer_id" IS NOT NULL AND "ended_at" IS NOT NULL;
