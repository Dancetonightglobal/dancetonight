CREATE TABLE "ai_quota" (
	"provider" text NOT NULL,
	"day_key" text NOT NULL,
	"scope" text NOT NULL,
	"amount" numeric(14, 4) DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_quota_provider_day_key_scope_pk" PRIMARY KEY("provider","day_key","scope")
);
--> statement-breakpoint
CREATE TABLE "extraction_cache" (
	"content_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraction_cache_content_hash_prompt_version_pk" PRIMARY KEY("content_hash","prompt_version")
);
--> statement-breakpoint
ALTER TABLE "cost_log" ADD COLUMN "cost" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "cost_log" ADD COLUMN "unit" text;