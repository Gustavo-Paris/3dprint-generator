ALTER TABLE "iterations" ALTER COLUMN "sliced_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "iterations" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "iterations" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_current_iteration_id_iterations_id_fk" FOREIGN KEY ("current_iteration_id") REFERENCES "public"."iterations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "iterations_project_id_created_at_idx" ON "iterations" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "projects_user_id_idx" ON "projects" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "iterations" DROP COLUMN "parent_iteration_id";--> statement-breakpoint
ALTER TABLE "iterations" ADD CONSTRAINT "iterations_status_check" CHECK ("iterations"."status" IN ('generating','ready','failed','sliced'));--> statement-breakpoint
ALTER TABLE "iterations" ADD CONSTRAINT "iterations_base_mode_check" CHECK ("iterations"."base_mode" IS NULL OR "iterations"."base_mode" IN ('mesh_only','with_base'));--> statement-breakpoint
ALTER TABLE "iterations" ADD CONSTRAINT "iterations_strategy_check" CHECK ("iterations"."strategy" IN ('parametric', 'generative', 'hollow_cylinder', 'flat_plate', 'disc', 'bookmark', 'pin', 'custom_keychain', 'mug', 'imported', 'composite', 'freeform', 'flexified'));