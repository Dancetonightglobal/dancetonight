-- D-768 (the owner 2026-11-06 "flag, keep card"): the daily check of each card's own link, one row per URL.
-- RLS on with no policies, like every public table (0008): the app connects as the owner.
CREATE TABLE "link_checks" (
	"url" text PRIMARY KEY NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"broken" boolean DEFAULT false NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"reason" text
);
--> statement-breakpoint
ALTER TABLE "link_checks" ENABLE ROW LEVEL SECURITY;
