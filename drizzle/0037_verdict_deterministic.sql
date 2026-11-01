ALTER TABLE "diagnostic_runs" ADD COLUMN IF NOT EXISTS "verdict_scope" text;--> statement-breakpoint
ALTER TABLE "diagnostic_runs" ADD COLUMN IF NOT EXISTS "verdict_root" jsonb;--> statement-breakpoint
ALTER TABLE "diagnostic_runs" ADD COLUMN IF NOT EXISTS "verdict_secondary" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "diagnostic_runs" ADD COLUMN IF NOT EXISTS "verdict_held" boolean DEFAULT false NOT NULL;
