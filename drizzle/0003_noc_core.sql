CREATE TABLE "routers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"username" text NOT NULL,
	"password_enc" text NOT NULL,
	"status" text DEFAULT 'aktif' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routers_host_unique" UNIQUE("host"),
	CONSTRAINT "routers_status_check" CHECK ("routers"."status" in ('aktif', 'nonaktif'))
);
--> statement-breakpoint
CREATE TABLE "olts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"brand" text NOT NULL,
	"driver" text NOT NULL,
	"username" text NOT NULL,
	"password_enc" text NOT NULL,
	"status" text DEFAULT 'aktif' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "olts_host_unique" UNIQUE("host"),
	CONSTRAINT "olts_status_check" CHECK ("olts"."status" in ('aktif', 'nonaktif'))
);
--> statement-breakpoint
CREATE TABLE "olt_pon_ports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"olt_id" uuid NOT NULL,
	"pon_index" integer NOT NULL,
	"rx_power" numeric(6, 2),
	"tx_power" numeric(6, 2),
	"attenuation" numeric(6, 2),
	"onu_online_count" integer DEFAULT 0 NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "olt_pon_ports_olt_pon_unique" UNIQUE("olt_id","pon_index")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"pppoe_username" text NOT NULL,
	"router_id" uuid NOT NULL,
	"address" text,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"billing_status" text DEFAULT 'lunas' NOT NULL,
	"optical_power" numeric(6, 2),
	"is_online" boolean DEFAULT false NOT NULL,
	"last_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_pppoe_username_unique" UNIQUE("pppoe_username"),
	CONSTRAINT "customers_billing_status_check" CHECK ("customers"."billing_status" in ('lunas', 'isolir')),
	CONSTRAINT "customers_latitude_check" CHECK ("customers"."latitude" between -90 and 90),
	CONSTRAINT "customers_longitude_check" CHECK ("customers"."longitude" between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "olt_onus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"olt_id" uuid NOT NULL,
	"pon_index" integer NOT NULL,
	"onu_index" integer NOT NULL,
	"customer_id" uuid,
	"rx_power" numeric(6, 2),
	"tx_power" numeric(6, 2),
	"attenuation" numeric(6, 2),
	"status" text DEFAULT 'offline' NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "olt_onus_olt_pon_onu_unique" UNIQUE("olt_id","pon_index","onu_index"),
	CONSTRAINT "olt_onus_status_check" CHECK ("olt_onus"."status" in ('online', 'offline'))
);
--> statement-breakpoint
CREATE TABLE "billing_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" text NOT NULL,
	"invoice_ref" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_status_customer_id_unique" UNIQUE("customer_id"),
	CONSTRAINT "billing_status_status_check" CHECK ("billing_status"."status" in ('lunas', 'isolir'))
);
--> statement-breakpoint
CREATE TABLE "network_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"router_id" uuid NOT NULL,
	"customer_id" uuid,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "network_logs_type_check" CHECK ("network_logs"."type" in ('queue', 'cpu', 'optical', 'offline', 'port')),
	CONSTRAINT "network_logs_severity_check" CHECK ("network_logs"."severity" in ('info', 'warning', 'critical')),
	CONSTRAINT "network_logs_period_check" CHECK ("network_logs"."ended_at" is null or "network_logs"."ended_at" >= "network_logs"."started_at")
);
--> statement-breakpoint
CREATE TABLE "cpe_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cpe_tasks_action_check" CHECK ("cpe_tasks"."action" in ('change_ssid', 'change_password', 'list_hosts')),
	CONSTRAINT "cpe_tasks_status_check" CHECK ("cpe_tasks"."status" in ('pending', 'success', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "olt_pon_ports" ADD CONSTRAINT "olt_pon_ports_olt_id_olts_id_fk" FOREIGN KEY ("olt_id") REFERENCES "public"."olts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_router_id_routers_id_fk" FOREIGN KEY ("router_id") REFERENCES "public"."routers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "olt_onus" ADD CONSTRAINT "olt_onus_olt_id_olts_id_fk" FOREIGN KEY ("olt_id") REFERENCES "public"."olts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "olt_onus" ADD CONSTRAINT "olt_onus_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_status" ADD CONSTRAINT "billing_status_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_logs" ADD CONSTRAINT "network_logs_router_id_routers_id_fk" FOREIGN KEY ("router_id") REFERENCES "public"."routers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_logs" ADD CONSTRAINT "network_logs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cpe_tasks" ADD CONSTRAINT "cpe_tasks_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cpe_tasks" ADD CONSTRAINT "cpe_tasks_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_router_idx" ON "customers" USING btree ("router_id");--> statement-breakpoint
CREATE UNIQUE INDEX "olt_onus_customer_unique" ON "olt_onus" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "olt_onus_olt_pon_idx" ON "olt_onus" USING btree ("olt_id","pon_index");--> statement-breakpoint
CREATE INDEX "network_logs_started_idx" ON "network_logs" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "network_logs_router_started_idx" ON "network_logs" USING btree ("router_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "network_logs_active_idx" ON "network_logs" USING btree ("type","started_at" DESC NULLS LAST) WHERE "network_logs"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "cpe_tasks_customer_created_idx" ON "cpe_tasks" USING btree ("customer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cpe_tasks_pending_idx" ON "cpe_tasks" USING btree ("created_at") WHERE "cpe_tasks"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_user_created_idx" ON "audit_log" USING btree ("user_id","created_at" DESC NULLS LAST);