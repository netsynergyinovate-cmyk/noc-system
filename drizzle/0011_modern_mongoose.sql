CREATE TABLE "billing_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"username" text NOT NULL,
	"password_enc" text NOT NULL,
	"cookies_enc" text,
	"csrf_token" text,
	"status" text DEFAULT 'not_logged_in' NOT NULL,
	"csrf_status" text DEFAULT 'not_required' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_login_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"backoff_until" timestamp with time zone,
	"cookie_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
