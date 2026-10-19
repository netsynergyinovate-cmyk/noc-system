CREATE TABLE "network_routes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"olt_id" text,
	"odc_id" text,
	"pon_port" text,
	"status" text DEFAULT 'active' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "network_infrastructure" ADD COLUMN "route_id" text;--> statement-breakpoint
CREATE INDEX "network_routes_olt_idx" ON "network_routes" USING btree ("olt_id");--> statement-breakpoint
CREATE INDEX "network_routes_odc_idx" ON "network_routes" USING btree ("odc_id");--> statement-breakpoint
CREATE INDEX "network_infra_route_idx" ON "network_infrastructure" USING btree ("route_id");--> statement-breakpoint
ALTER TABLE "network_infrastructure" ADD CONSTRAINT "network_infra_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "network_routes"("id") ON DELETE SET NULL;