CREATE TABLE "device_test_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_type" text NOT NULL,
	"device_id" uuid,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"username" text,
	"endpoint_tested" text NOT NULL,
	"mode" text DEFAULT 'real' NOT NULL,
	"status" text NOT NULL,
	"code" text NOT NULL,
	"status_code" integer,
	"message" text NOT NULL,
	"latency_ms" integer,
	"ok" boolean NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tested_by" text,
	"tested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_test_results_type_check" CHECK ("device_test_results"."device_type" in ('mikrotik', 'olt', 'genieacs', 'billing')),
	CONSTRAINT "device_test_results_status_check" CHECK ("device_test_results"."status" in ('connected', 'disconnected', 'error', 'timeout', 'untested')),
	CONSTRAINT "device_test_results_code_check" CHECK ("device_test_results"."code" in ('OK', 'TIMEOUT', 'AUTH_FAILED', 'CONNECTION_REFUSED', 'INVALID_PORT', 'INVALID_HOST', 'HTTP_ERROR', 'DNS_ERROR'))
);
--> statement-breakpoint
CREATE INDEX "device_test_results_type_idx" ON "device_test_results" USING btree ("device_type","tested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "device_test_results_host_idx" ON "device_test_results" USING btree ("host","tested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "device_test_results_device_id_idx" ON "device_test_results" USING btree ("device_id","tested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "device_test_results_tested_at_idx" ON "device_test_results" USING btree ("tested_at" DESC NULLS LAST);