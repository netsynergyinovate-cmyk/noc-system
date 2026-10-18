CREATE TABLE "vlan_traffic_samples" (
	"vlan_name" text NOT NULL,
	"vlan_id" integer NOT NULL,
	"pon_index" integer NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL,
	"download_mbps" double precision NOT NULL,
	"upload_mbps" double precision NOT NULL,
	"rx_bytes" bigint NOT NULL,
	"tx_bytes" bigint NOT NULL,
	CONSTRAINT "vlan_traffic_samples_pkey" PRIMARY KEY("vlan_name","sampled_at"),
	CONSTRAINT "vlan_traffic_samples_nonnegative_check" CHECK ("vlan_traffic_samples"."download_mbps" >= 0 and "vlan_traffic_samples"."upload_mbps" >= 0)
);
--> statement-breakpoint
CREATE TABLE "runsnet_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cust_id" text NOT NULL,
	"name" text NOT NULL,
	"service_profile" text,
	"type" text,
	"spk_date" text,
	"active_date" text,
	"expired_date" text,
	"connectivity" text,
	"status" text NOT NULL,
	"raw_json" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runsnet_customers_cust_id_unique" UNIQUE("cust_id")
);
--> statement-breakpoint
CREATE TABLE "runsnet_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_code" text NOT NULL,
	"cust_id" text NOT NULL,
	"cust_name" text NOT NULL,
	"periode" text,
	"due_date" text,
	"amount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"remaining_amount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"agent" text,
	"status" text NOT NULL,
	"file_url" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runsnet_invoices_invoice_code_unique" UNIQUE("invoice_code")
);
--> statement-breakpoint
CREATE TABLE "runsnet_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_code" text NOT NULL,
	"invoice_code" text,
	"cust_id" text NOT NULL,
	"cust_name" text NOT NULL,
	"periode" text,
	"pay_date" text,
	"amount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"method" text,
	"agent" text,
	"operator" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runsnet_payments_payment_code_unique" UNIQUE("payment_code")
);
--> statement-breakpoint
CREATE TABLE "runsnet_sync_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text NOT NULL,
	"customers_count" integer DEFAULT 0 NOT NULL,
	"invoices_count" integer DEFAULT 0 NOT NULL,
	"payments_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "network_cables" (
	"id" text PRIMARY KEY NOT NULL,
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
CREATE TABLE "network_device_relations" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_id" text NOT NULL,
	"child_id" text NOT NULL,
	"relation_type" text DEFAULT 'hierarchy' NOT NULL,
	"parent_port" text,
	"child_port" text,
	"status" text DEFAULT 'active' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "network_device_rel_not_self" CHECK ("network_device_relations"."parent_id" != "network_device_relations"."child_id"),
	CONSTRAINT "network_device_rel_type_check" CHECK ("network_device_relations"."relation_type" in ('hierarchy', 'feeder', 'backup', 'distribution'))
);
--> statement-breakpoint
CREATE TABLE "network_infrastructure" (
	"id" text PRIMARY KEY NOT NULL,
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
	CONSTRAINT "network_infra_type_check" CHECK ("network_infrastructure"."type" in ('router', 'olt', 'odp', 'odc', 'pole', 'server')),
	CONSTRAINT "network_infra_status_check" CHECK ("network_infrastructure"."status" in ('active', 'inactive', 'maintenance')),
	CONSTRAINT "network_infra_latitude_check" CHECK ("network_infrastructure"."latitude" between -90 and 90),
	CONSTRAINT "network_infra_longitude_check" CHECK ("network_infrastructure"."longitude" between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "map_drawing_layers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"opacity" numeric(3, 2) DEFAULT 1 NOT NULL,
	"z_index" integer DEFAULT 1 NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"shapes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "routers" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "routers" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "olts" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "olts" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "network_device_relations" ADD CONSTRAINT "network_device_relations_parent_id_network_infrastructure_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."network_infrastructure"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_device_relations" ADD CONSTRAINT "network_device_relations_child_id_network_infrastructure_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."network_infrastructure"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vlan_traffic_samples_vlan_time_idx" ON "vlan_traffic_samples" USING btree ("vlan_name","sampled_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "vlan_traffic_samples_time_idx" ON "vlan_traffic_samples" USING btree ("sampled_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "runsnet_customers_cust_id_idx" ON "runsnet_customers" USING btree ("cust_id");--> statement-breakpoint
CREATE INDEX "runsnet_customers_status_idx" ON "runsnet_customers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "runsnet_invoices_cust_id_idx" ON "runsnet_invoices" USING btree ("cust_id");--> statement-breakpoint
CREATE INDEX "runsnet_invoices_status_idx" ON "runsnet_invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "runsnet_invoices_periode_idx" ON "runsnet_invoices" USING btree ("periode");--> statement-breakpoint
CREATE INDEX "runsnet_payments_cust_id_idx" ON "runsnet_payments" USING btree ("cust_id");--> statement-breakpoint
CREATE INDEX "runsnet_payments_invoice_code_idx" ON "runsnet_payments" USING btree ("invoice_code");--> statement-breakpoint
CREATE INDEX "runsnet_payments_pay_date_idx" ON "runsnet_payments" USING btree ("pay_date");--> statement-breakpoint
CREATE INDEX "runsnet_sync_logs_started_at_idx" ON "runsnet_sync_logs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "network_cables_source_idx" ON "network_cables" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "network_cables_target_idx" ON "network_cables" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "network_cables_type_idx" ON "network_cables" USING btree ("cable_type");--> statement-breakpoint
CREATE INDEX "network_device_rel_parent_idx" ON "network_device_relations" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "network_device_rel_child_idx" ON "network_device_relations" USING btree ("child_id");--> statement-breakpoint
CREATE INDEX "network_device_rel_type_idx" ON "network_device_relations" USING btree ("relation_type");--> statement-breakpoint
CREATE INDEX "network_infra_type_idx" ON "network_infrastructure" USING btree ("type");--> statement-breakpoint
CREATE INDEX "network_infra_status_idx" ON "network_infrastructure" USING btree ("status");--> statement-breakpoint
CREATE INDEX "network_infra_parent_idx" ON "network_infrastructure" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "map_drawing_layers_visible_idx" ON "map_drawing_layers" USING btree ("is_visible");--> statement-breakpoint
CREATE INDEX "map_drawing_layers_z_index_idx" ON "map_drawing_layers" USING btree ("z_index");