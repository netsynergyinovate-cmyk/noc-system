CREATE TABLE "ont_web_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"acs_url" text NOT NULL,
	"acs_username" text,
	"acs_password_enc" text,
	"inform_interval" integer DEFAULT 300 NOT NULL,
	"web_username" text,
	"web_password_enc" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ont_web_settings_singleton" CHECK ("ont_web_settings"."id" = 'default'),
	CONSTRAINT "ont_web_settings_interval" CHECK ("ont_web_settings"."inform_interval" between 30 and 86400)
);
