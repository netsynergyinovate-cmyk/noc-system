CREATE TABLE "deploy_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nama" text DEFAULT 'SERVER NATIVE' NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 22 NOT NULL,
	"ssh_user" text NOT NULL,
	"mode" text DEFAULT 'lan' NOT NULL,
	"tailscale_host" text,
	"connection_reason" text,
	"host_key_fingerprint" text,
	"device_access_level" text DEFAULT 'simulator' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deploy_targets_mode_check" CHECK ("deploy_targets"."mode" in ('lan', 'tailscale', 'tunnel')),
	CONSTRAINT "deploy_targets_access_level_check" CHECK ("deploy_targets"."device_access_level" in ('simulator', 'baca-saja', 'penuh'))
);
--> statement-breakpoint
CREATE TABLE "deploy_config_syncs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"tabel" text NOT NULL,
	"disisipkan" integer DEFAULT 0 NOT NULL,
	"diperbarui" integer DEFAULT 0 NOT NULL,
	"dilewati" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'berhasil' NOT NULL,
	"disinkronkan_pada" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deploy_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"versi" text NOT NULL,
	"path" text NOT NULL,
	"dipasang_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"aktif" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deploy_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid,
	"versi" text NOT NULL,
	"jenis" text NOT NULL,
	"status" text DEFAULT 'berjalan' NOT NULL,
	"titik_balik_versi" text,
	"otomatis" boolean DEFAULT false NOT NULL,
	"dijalankan_oleh" text DEFAULT 'Operator' NOT NULL,
	"mulai" timestamp with time zone DEFAULT now() NOT NULL,
	"selesai" timestamp with time zone,
	CONSTRAINT "deploy_runs_jenis_check" CHECK ("deploy_runs"."jenis" in ('deploy', 'rollback', 'uji')),
	CONSTRAINT "deploy_runs_status_check" CHECK ("deploy_runs"."status" in ('berjalan', 'berhasil', 'gagal'))
);
--> statement-breakpoint
CREATE TABLE "deploy_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"urutan" integer NOT NULL,
	"nama" text NOT NULL,
	"status" text DEFAULT 'menunggu' NOT NULL,
	"keluaran" text,
	"mulai" timestamp with time zone,
	"selesai" timestamp with time zone,
	CONSTRAINT "deploy_steps_status_check" CHECK ("deploy_steps"."status" in ('menunggu', 'berjalan', 'berhasil', 'gagal', 'dilewati'))
);
--> statement-breakpoint
CREATE TABLE "deploy_write_guard_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint" text NOT NULL,
	"method" text NOT NULL,
	"reason" text NOT NULL,
	"payload_preview" text,
	"blocked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deploy_config_syncs" ADD CONSTRAINT "deploy_config_syncs_run_id_deploy_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."deploy_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploy_releases" ADD CONSTRAINT "deploy_releases_target_id_deploy_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."deploy_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploy_runs" ADD CONSTRAINT "deploy_runs_target_id_deploy_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."deploy_targets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploy_steps" ADD CONSTRAINT "deploy_steps_run_id_deploy_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."deploy_runs"("id") ON DELETE cascade ON UPDATE no action;