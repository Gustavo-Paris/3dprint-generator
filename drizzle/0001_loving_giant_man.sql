ALTER TABLE "iterations" ADD COLUMN "sliced_blob_url" text;--> statement-breakpoint
ALTER TABLE "iterations" ADD COLUMN "sliced_meta" jsonb;--> statement-breakpoint
ALTER TABLE "iterations" ADD COLUMN "sliced_at" timestamp;