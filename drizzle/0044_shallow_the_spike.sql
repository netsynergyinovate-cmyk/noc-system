ALTER TABLE "ssh_credentials" ALTER COLUMN "private_key_enc" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ssh_credentials" ADD COLUMN IF NOT EXISTS "password_enc" text;