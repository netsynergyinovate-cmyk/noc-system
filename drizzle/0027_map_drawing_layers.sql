CREATE TABLE IF NOT EXISTS "map_drawing_layers" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"opacity" numeric(3, 2) DEFAULT 1.0 NOT NULL,
	"z_index" integer DEFAULT 1 NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"shapes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "map_drawing_layers_visible_idx" ON "map_drawing_layers" ("is_visible");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "map_drawing_layers_z_index_idx" ON "map_drawing_layers" ("z_index");
