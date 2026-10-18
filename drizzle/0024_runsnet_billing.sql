CREATE TABLE IF NOT EXISTS "runsnet_customers" (
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
CREATE INDEX IF NOT EXISTS "runsnet_customers_cust_id_idx" ON "runsnet_customers" ("cust_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runsnet_customers_status_idx" ON "runsnet_customers" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "runsnet_invoices" (
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
CREATE INDEX IF NOT EXISTS "runsnet_invoices_cust_id_idx" ON "runsnet_invoices" ("cust_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runsnet_invoices_status_idx" ON "runsnet_invoices" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runsnet_invoices_periode_idx" ON "runsnet_invoices" ("periode");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "runsnet_payments" (
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
CREATE INDEX IF NOT EXISTS "runsnet_payments_cust_id_idx" ON "runsnet_payments" ("cust_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runsnet_payments_invoice_code_idx" ON "runsnet_payments" ("invoice_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runsnet_payments_pay_date_idx" ON "runsnet_payments" ("pay_date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "runsnet_sync_logs" (
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
CREATE INDEX IF NOT EXISTS "runsnet_sync_logs_started_at_idx" ON "runsnet_sync_logs" ("started_at");

