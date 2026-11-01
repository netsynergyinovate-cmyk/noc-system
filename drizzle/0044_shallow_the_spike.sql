CREATE TABLE IF NOT EXISTS "feature_markers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"user_email" varchar(255) NOT NULL,
	"user_role" varchar(50) NOT NULL,
	"page_path" varchar(255) NOT NULL,
	"page_title" varchar(255) DEFAULT '' NOT NULL,
	"element_selector" varchar(500) DEFAULT '' NOT NULL,
	"element_text" text DEFAULT '' NOT NULL,
	"feature_name" varchar(255) NOT NULL,
	"category" varchar(50) DEFAULT 'used_frequently' NOT NULL,
	"frequency" varchar(50) DEFAULT 'daily' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" varchar(50) DEFAULT 'baru' NOT NULL,
	"developer_notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ssh_credentials" ALTER COLUMN "private_key_enc" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ssh_credentials" ADD COLUMN IF NOT EXISTS "password_enc" text;--> statement-breakpoint
ALTER TABLE "feature_markers" ADD CONSTRAINT "feature_markers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feature_markers_created_at_idx" ON "feature_markers" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "feature_markers_page_path_idx" ON "feature_markers" USING btree ("page_path");--> statement-breakpoint
CREATE INDEX "feature_markers_category_idx" ON "feature_markers" USING btree ("category");--> statement-breakpoint
CREATE INDEX "feature_markers_status_idx" ON "feature_markers" USING btree ("status");