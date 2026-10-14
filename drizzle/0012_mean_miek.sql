CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"router_id" uuid,
	"customer_id" uuid,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"title" text,
	"message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"time_source" text DEFAULT 'poll' NOT NULL,
	"time_uncertainty_seconds" integer DEFAULT 0 NOT NULL,
	"end_time_source" text,
	"end_time_uncertainty_seconds" integer DEFAULT 0,
	"handled_by" text,
	"handled_at" timestamp with time zone,
	"location_name" text,
	"location_address" text,
	"location_odp" text,
	"latitude" double precision,
	"longitude" double precision,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ticket_status" text DEFAULT 'open' NOT NULL,
	"ticket_priority" text DEFAULT 'medium' NOT NULL,
	"ticket_notes" text,
	"action_taken" text,
	"dispatch_technician" boolean DEFAULT false,
	"technician_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alerts_type_check" CHECK ("alerts"."type" in ('queue', 'cpu', 'port', 'optical', 'offline')),
	CONSTRAINT "alerts_severity_check" CHECK ("alerts"."severity" in ('info', 'warning', 'critical')),
	CONSTRAINT "alerts_status_check" CHECK ("alerts"."status" in ('active', 'resolved', 'handled', 'acknowledged')),
	CONSTRAINT "alerts_ticket_status_check" CHECK ("alerts"."ticket_status" in ('open', 'in_progress', 'resolved', 'escalated')),
	CONSTRAINT "alerts_ticket_priority_check" CHECK ("alerts"."ticket_priority" in ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "alerts_period_check" CHECK ("alerts"."ended_at" is null or "alerts"."ended_at" >= "alerts"."started_at")
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_router_id_routers_id_fk" FOREIGN KEY ("router_id") REFERENCES "public"."routers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_status_idx" ON "alerts" USING btree ("status","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "alerts_started_idx" ON "alerts" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "alerts_router_started_idx" ON "alerts" USING btree ("router_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "alerts_customer_idx" ON "alerts" USING btree ("customer_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "alerts_active_idx" ON "alerts" USING btree ("type","started_at" DESC NULLS LAST) WHERE "alerts"."status" = 'active';