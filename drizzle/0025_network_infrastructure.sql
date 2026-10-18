CREATE TABLE IF NOT EXISTS "network_infrastructure" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"host" text,
	"status" text DEFAULT 'active' NOT NULL,
	"latitude" numeric(9, 6) NOT NULL,
	"longitude" numeric(9, 6) NOT NULL,
	"parent_id" text,
	"capacity" integer,
	"used_capacity" integer DEFAULT 0,
	"description" text,
	"address" text,
	"details" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "network_infra_type_check" CHECK ("type" in ('router', 'olt', 'odp', 'odc', 'pole', 'server')),
	CONSTRAINT "network_infra_status_check" CHECK ("status" in ('active', 'inactive', 'maintenance')),
	CONSTRAINT "network_infra_latitude_check" CHECK ("latitude" between -90 and 90),
	CONSTRAINT "network_infra_longitude_check" CHECK ("longitude" between -180 and 180)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_infra_type_idx" ON "network_infrastructure" ("type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_infra_status_idx" ON "network_infrastructure" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_infra_parent_idx" ON "network_infrastructure" ("parent_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "network_cables" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"source_id" text NOT NULL,
	"target_id" text,
	"target_type" text DEFAULT 'infrastructure' NOT NULL,
	"cable_type" text DEFAULT 'distribution' NOT NULL,
	"core_capacity" integer DEFAULT 12 NOT NULL,
	"color" text DEFAULT '#3b82f6' NOT NULL,
	"length_meters" numeric(8, 2),
	"polyline" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_cables_source_idx" ON "network_cables" ("source_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_cables_target_idx" ON "network_cables" ("target_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_cables_type_idx" ON "network_cables" ("cable_type");
