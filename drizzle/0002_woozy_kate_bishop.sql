ALTER TABLE "iterations" ADD COLUMN "strategy" text DEFAULT 'parametric' NOT NULL;--> statement-breakpoint
ALTER TABLE "iterations" ADD COLUMN "mesh_blob_url" text;