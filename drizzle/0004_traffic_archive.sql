CREATE TABLE "traffic_samples" (
	"router_id" uuid NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL,
	"rx_mbps" double precision NOT NULL,
	"tx_mbps" double precision NOT NULL,
	CONSTRAINT "traffic_samples_pkey" PRIMARY KEY("router_id","sampled_at"),
	CONSTRAINT "traffic_samples_nonnegative_check" CHECK ("traffic_samples"."rx_mbps" >= 0 and "traffic_samples"."tx_mbps" >= 0)
);
--> statement-breakpoint
ALTER TABLE "traffic_samples" ADD CONSTRAINT "traffic_samples_router_id_routers_id_fk" FOREIGN KEY ("router_id") REFERENCES "public"."routers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "traffic_samples_time_idx" ON "traffic_samples" USING btree ("sampled_at" DESC NULLS LAST);
--> statement-breakpoint
-- Bila ekstensi TimescaleDB tersedia di server, jadikan tabel ini hypertable
-- (partisi harian) dengan retensi otomatis 30 hari. Tanpa Timescale (mis. image
-- postgres biasa) tabel tetap berfungsi sebagai tabel biasa, dan baris lama
-- perlu dibersihkan oleh backend. Kegagalan mengaktifkan Timescale (mis. tanpa
-- izin membuat ekstensi) hanya menjadi peringatan agar migrasi tidak berhenti.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') THEN
    CREATE EXTENSION IF NOT EXISTS timescaledb;
    PERFORM create_hypertable(
      'traffic_samples', 'sampled_at',
      chunk_time_interval => INTERVAL '1 day',
      if_not_exists => TRUE,
      migrate_data => TRUE
    );
    PERFORM add_retention_policy('traffic_samples', INTERVAL '30 days', if_not_exists => TRUE);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'TimescaleDB tidak diaktifkan untuk traffic_samples, memakai tabel biasa: %', SQLERRM;
END
$$;
