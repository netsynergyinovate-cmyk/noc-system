CREATE TABLE "firewall_rule_hits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"table" text NOT NULL,
	"chain" text NOT NULL,
	"rule_index" integer NOT NULL,
	"rule_id" text NOT NULL,
	"action" text NOT NULL,
	"scope" text NOT NULL,
	"summary" text NOT NULL,
	"comment" text NOT NULL,
	"disabled" boolean NOT NULL,
	"matched_packets" bigint NOT NULL,
	"matched_bytes" bigint NOT NULL,
	"is_stale" boolean NOT NULL,
	CONSTRAINT "firewall_rule_hits_table_check" CHECK ("firewall_rule_hits"."table" in ('filter', 'raw', 'nat', 'mangle')),
	CONSTRAINT "firewall_rule_hits_scope_check" CHECK ("firewall_rule_hits"."scope" in ('khusus', 'umum', 'mungkin'))
);
--> statement-breakpoint
CREATE TABLE "firewall_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"router_id" uuid,
	"customer_id" uuid,
	"taken_at" timestamp with time zone NOT NULL,
	"customer_ip" text NOT NULL,
	"fasttrack_active" boolean NOT NULL,
	"conntrack_count" integer NOT NULL,
	"conntrack_total" integer,
	"conntrack_max" integer,
	"raw_drop_matched" boolean NOT NULL,
	"address_list_matched" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
ALTER TABLE "firewall_rule_hits" ADD CONSTRAINT "firewall_rule_hits_snapshot_id_firewall_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."firewall_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firewall_snapshots" ADD CONSTRAINT "firewall_snapshots_run_id_diagnostic_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."diagnostic_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firewall_snapshots" ADD CONSTRAINT "firewall_snapshots_router_id_routers_id_fk" FOREIGN KEY ("router_id") REFERENCES "public"."routers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firewall_snapshots" ADD CONSTRAINT "firewall_snapshots_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "firewall_rule_hits_snapshot_idx" ON "firewall_rule_hits" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "firewall_snapshots_run_idx" ON "firewall_snapshots" USING btree ("run_id");