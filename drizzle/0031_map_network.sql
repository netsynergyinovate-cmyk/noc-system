CREATE TABLE "map_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"type" varchar(32) NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"capacity" integer DEFAULT 0 NOT NULL,
	"status" varchar(32) DEFAULT 'normal' NOT NULL,
	"parent_device_id" text,
	"notes" text,
	"splitter_ratio" integer,
	"splitter_tap" integer,
	"odc_port" integer,
	"central_olt_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "map_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"customer_number" varchar(64) NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"region" varchar(64) DEFAULT '' NOT NULL,
	"status" varchar(32) DEFAULT 'terhubung' NOT NULL,
	"billing_status" varchar(32) DEFAULT 'aktif' NOT NULL,
	"package_plan" varchar(64) DEFAULT 'Standard',
	"monthly_fee" integer DEFAULT 250000,
	"optical_power" double precision DEFAULT -19.5,
	"onu_serial" varchar(64),
	"cpe_ssid" varchar(64),
	"cpe_ip" varchar(64),
	"cpe_hosts" integer DEFAULT 0,
	"latitude" double precision,
	"longitude" double precision,
	"odp_id" text,
	"odp_port" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "map_customers_customer_number_unique" UNIQUE("customer_number")
);
--> statement-breakpoint
CREATE TABLE "cable_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(160) NOT NULL,
	"cable_type" varchar(64) NOT NULL,
	"fiber_capacity" integer NOT NULL,
	"from_device_id" text NOT NULL,
	"to_device_id" text,
	"sampling_interval_m" integer DEFAULT 50 NOT NULL,
	"total_length_m" double precision DEFAULT 0 NOT NULL,
	"color" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cable_routes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "cable_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_id" uuid NOT NULL,
	"from_device_id" text NOT NULL,
	"to_device_id" text,
	"customer_id" text,
	"sequence" integer NOT NULL,
	"geometry" jsonb NOT NULL,
	"length_m" double precision DEFAULT 0 NOT NULL,
	"snapped" boolean DEFAULT false NOT NULL,
	"snap_provider" varchar(64) DEFAULT 'central-api' NOT NULL,
	"snap_tolerance_m" integer DEFAULT 30 NOT NULL,
	"snapped_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cable_segment_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"segment_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"cumulative_m" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "map_layers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"layer_order" integer DEFAULT 0 NOT NULL,
	"opacity" double precision DEFAULT 1 NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"shapes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "map_overrides" (
	"entity_type" varchar(16) NOT NULL,
	"entity_id" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"parent_device_id" text,
	"parent_cleared" boolean DEFAULT false NOT NULL,
	"notes" text,
	"odp_port" integer,
	"splitter_ratio" integer,
	"splitter_tap" integer,
	"odc_port" integer,
	"device_type" varchar(16),
	"name" varchar(160),
	"central_olt_id" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "map_overrides_entity_type_entity_id_pk" PRIMARY KEY("entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "map_undo_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" varchar(160) NOT NULL,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cable_segments" ADD CONSTRAINT "cable_segments_route_id_cable_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."cable_routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable_segment_samples" ADD CONSTRAINT "cable_segment_samples_segment_id_cable_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."cable_segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "map_devices_parent_idx" ON "map_devices" USING btree ("parent_device_id");--> statement-breakpoint
CREATE INDEX "map_devices_type_idx" ON "map_devices" USING btree ("type");--> statement-breakpoint
CREATE INDEX "map_devices_coords_idx" ON "map_devices" USING btree ("latitude","longitude");--> statement-breakpoint
CREATE INDEX "map_customers_number_idx" ON "map_customers" USING btree ("customer_number");--> statement-breakpoint
CREATE INDEX "map_customers_coords_idx" ON "map_customers" USING btree ("latitude","longitude");--> statement-breakpoint
CREATE INDEX "map_customers_status_idx" ON "map_customers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "map_customers_odp_idx" ON "map_customers" USING btree ("odp_id");--> statement-breakpoint
CREATE INDEX "cable_routes_code_idx" ON "cable_routes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "cable_routes_from_idx" ON "cable_routes" USING btree ("from_device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cable_segments_route_seq_idx" ON "cable_segments" USING btree ("route_id","sequence");--> statement-breakpoint
CREATE INDEX "cable_segments_route_idx" ON "cable_segments" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "cable_segments_customer_idx" ON "cable_segments" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cable_samples_seg_seq_idx" ON "cable_segment_samples" USING btree ("segment_id","sequence");--> statement-breakpoint
CREATE INDEX "cable_samples_segment_idx" ON "cable_segment_samples" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "map_undo_entries_created_idx" ON "map_undo_entries" USING btree ("created_at");