ALTER TABLE "netflow_samples" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "netflow_samples" ADD COLUMN "direction" text;--> statement-breakpoint
ALTER TABLE "netflow_samples" ADD COLUMN "flows" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "netflow_samples" ADD CONSTRAINT "netflow_samples_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "netflow_customer_idx" ON "netflow_samples" USING btree ("customer_id","captured_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "netflow_samples" ADD CONSTRAINT "netflow_direction_check" CHECK ("netflow_samples"."direction" is null or "netflow_samples"."direction" in ('up', 'down'));