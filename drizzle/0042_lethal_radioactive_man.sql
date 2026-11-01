CREATE TABLE "ssh_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"private_key_enc" text NOT NULL,
	"passphrase_enc" text,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ssh_credentials" ADD CONSTRAINT "ssh_credentials_target_id_deploy_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."deploy_targets"("id") ON DELETE cascade ON UPDATE no action;