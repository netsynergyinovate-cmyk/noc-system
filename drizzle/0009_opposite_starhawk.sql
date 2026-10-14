CREATE TABLE "netflow_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"router_id" uuid,
	"src_ip" text NOT NULL,
	"dst_ip" text NOT NULL,
	"src_port" integer NOT NULL,
	"dst_port" integer NOT NULL,
	"protocol" text NOT NULL,
	"bytes" bigint NOT NULL,
	"packets" integer DEFAULT 1 NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "netflow_samples" ADD CONSTRAINT "netflow_samples_router_id_routers_id_fk" FOREIGN KEY ("router_id") REFERENCES "public"."routers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "netflow_captured_idx" ON "netflow_samples" USING btree ("captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "netflow_src_ip_idx" ON "netflow_samples" USING btree ("src_ip","captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "netflow_dst_port_idx" ON "netflow_samples" USING btree ("dst_port","captured_at" DESC NULLS LAST);