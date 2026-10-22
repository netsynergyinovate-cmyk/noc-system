CREATE TABLE "customer_traffic_samples" (
	"customer_id" uuid NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"samples" integer NOT NULL,
	"download_mbps_avg" double precision NOT NULL,
	"upload_mbps_avg" double precision NOT NULL,
	"download_mbps_max" double precision NOT NULL,
	"upload_mbps_max" double precision NOT NULL,
	"download_bytes" bigint NOT NULL,
	"upload_bytes" bigint NOT NULL,
	CONSTRAINT "customer_traffic_samples_pkey" PRIMARY KEY("customer_id","bucket_start"),
	CONSTRAINT "customer_traffic_samples_nonnegative_check" CHECK ("customer_traffic_samples"."samples" > 0 and "customer_traffic_samples"."download_bytes" >= 0 and "customer_traffic_samples"."upload_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "customer_traffic_samples" ADD CONSTRAINT "customer_traffic_samples_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_traffic_samples_time_idx" ON "customer_traffic_samples" USING btree ("bucket_start" DESC NULLS LAST);