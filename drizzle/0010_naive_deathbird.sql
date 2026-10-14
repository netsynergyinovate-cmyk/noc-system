CREATE TABLE "whatsapp_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid,
	"recipient_target" text NOT NULL,
	"recipient_name" text NOT NULL,
	"message" text NOT NULL,
	"alert_kind" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"target" text NOT NULL,
	"type" text DEFAULT 'individual' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_recipients_target_unique" UNIQUE("target")
);
--> statement-breakpoint
ALTER TABLE "whatsapp_logs" ADD CONSTRAINT "whatsapp_logs_recipient_id_whatsapp_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."whatsapp_recipients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wa_logs_created_idx" ON "whatsapp_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "wa_logs_status_idx" ON "whatsapp_logs" USING btree ("status","created_at" DESC NULLS LAST);