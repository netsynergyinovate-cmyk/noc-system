CREATE TABLE IF NOT EXISTS "network_device_relations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"parent_id" text NOT NULL,
	"child_id" text NOT NULL,
	"relation_type" text DEFAULT 'hierarchy' NOT NULL,
	"parent_port" text,
	"child_port" text,
	"status" text DEFAULT 'active' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "network_device_rel_not_self" CHECK ("parent_id" != "child_id"),
	CONSTRAINT "network_device_rel_type_check" CHECK ("relation_type" in ('hierarchy', 'feeder', 'backup', 'distribution')),
	CONSTRAINT "network_device_rel_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "network_infrastructure"("id") ON DELETE CASCADE,
	CONSTRAINT "network_device_rel_child_fk" FOREIGN KEY ("child_id") REFERENCES "network_infrastructure"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_device_rel_parent_idx" ON "network_device_relations" ("parent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_device_rel_child_idx" ON "network_device_relations" ("child_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_device_rel_type_idx" ON "network_device_relations" ("relation_type");
