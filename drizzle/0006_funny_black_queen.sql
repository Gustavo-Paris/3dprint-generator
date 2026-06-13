CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"ai_base_url" text,
	"ai_model" text,
	"ai_classifier_model" text,
	"ai_api_key_enc" text,
	"meshy_api_key_enc" text,
	"slicer_url" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
