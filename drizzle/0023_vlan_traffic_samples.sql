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
CREATE INDEX "vlan_traffic_samples_vlan_time_idx" ON "vlan_traffic_samples" USING btree ("vlan_name", "sampled_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "vlan_traffic_samples_time_idx" ON "vlan_traffic_samples" USING btree ("sampled_at" DESC NULLS LAST);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') THEN
    CREATE EXTENSION IF NOT EXISTS timescaledb;
    PERFORM create_hypertable(
      'vlan_traffic_samples', 'sampled_at',
      chunk_time_interval => INTERVAL '1 day',
      if_not_exists => TRUE,
      migrate_data => TRUE
    );
    PERFORM add_retention_policy('vlan_traffic_samples', INTERVAL '30 days', if_not_exists => TRUE);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'TimescaleDB tidak diaktifkan untuk vlan_traffic_samples, memakai tabel biasa: %', SQLERRM;
END
$$;

