CREATE TABLE "browsing_access_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "browsing_daily_rollups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"date" date NOT NULL,
	"hit_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"category" text DEFAULT 'Umum' NOT NULL,
	"confidence" double precision DEFAULT 0.8 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "browsing_retention_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"deleted_rows" integer DEFAULT 0 NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "dns_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"client_ip" text NOT NULL,
	"domain" text NOT NULL,
	"queried_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"category" text NOT NULL,
	"confidence" double precision DEFAULT 1 NOT NULL,
	"source" text DEFAULT 'internal' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_catalog_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "domain_category_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"category" text NOT NULL,
	"set_by" text,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_category_overrides_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "netflow_exporters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"router_id" uuid,
	"host" text NOT NULL,
	"version" text NOT NULL,
	"sampling_rate" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tls_sni_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"client_ip" text NOT NULL,
	"sni_host" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_traffic_captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"router_id" uuid,
	"customer_ip" text NOT NULL,
	"duration_seconds" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"total_bytes" bigint DEFAULT 0 NOT NULL,
	"total_packets" integer DEFAULT 0 NOT NULL,
	"flow_count" integer DEFAULT 0 NOT NULL,
	"recorded_by" text DEFAULT 'Operator' NOT NULL,
	"top_app" text,
	"flows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "browsing_access_audit" ADD CONSTRAINT "browsing_access_audit_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browsing_daily_rollups" ADD CONSTRAINT "browsing_daily_rollups_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dns_queries" ADD CONSTRAINT "dns_queries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_category_overrides" ADD CONSTRAINT "domain_category_overrides_set_by_user_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "netflow_exporters" ADD CONSTRAINT "netflow_exporters_router_id_routers_id_fk" FOREIGN KEY ("router_id") REFERENCES "public"."routers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tls_sni_events" ADD CONSTRAINT "tls_sni_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_traffic_captures" ADD CONSTRAINT "customer_traffic_captures_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_traffic_captures" ADD CONSTRAINT "customer_traffic_captures_router_id_routers_id_fk" FOREIGN KEY ("router_id") REFERENCES "public"."routers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "browsing_audit_customer_idx" ON "browsing_access_audit" USING btree ("customer_id","opened_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "browsing_audit_user_idx" ON "browsing_access_audit" USING btree ("user_id","opened_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "browsing_rollups_unique" ON "browsing_daily_rollups" USING btree ("customer_id","domain","date");--> statement-breakpoint
CREATE INDEX "browsing_rollups_customer_date_idx" ON "browsing_daily_rollups" USING btree ("customer_id","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "browsing_rollups_domain_idx" ON "browsing_daily_rollups" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "browsing_retention_time_idx" ON "browsing_retention_runs" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "dns_queries_time_idx" ON "dns_queries" USING btree ("queried_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "dns_queries_customer_idx" ON "dns_queries" USING btree ("customer_id","queried_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "dns_queries_domain_idx" ON "dns_queries" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_catalog_domain_idx" ON "domain_catalog" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "domain_catalog_category_idx" ON "domain_catalog" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_overrides_domain_idx" ON "domain_category_overrides" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "netflow_exporters_router_idx" ON "netflow_exporters" USING btree ("router_id");--> statement-breakpoint
CREATE INDEX "tls_sni_time_idx" ON "tls_sni_events" USING btree ("observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tls_sni_customer_idx" ON "tls_sni_events" USING btree ("customer_id","observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tls_sni_host_idx" ON "tls_sni_events" USING btree ("sni_host");--> statement-breakpoint
CREATE INDEX "traffic_captures_customer_idx" ON "customer_traffic_captures" USING btree ("customer_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "traffic_captures_time_idx" ON "customer_traffic_captures" USING btree ("started_at" DESC NULLS LAST);