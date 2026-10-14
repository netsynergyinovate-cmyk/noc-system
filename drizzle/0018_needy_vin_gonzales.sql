ALTER TABLE "olts" ADD COLUMN "tr069_autobind_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "olt_onus" ADD COLUMN "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "olt_onus" ADD COLUMN "tr069_bound_at" timestamp with time zone;