-- Maintenance M1 (the owner 2026-11-16 "1a"): the addresses of past nights the retention job deleted, so each answers
-- "this night has passed" instead of a bare 404. RLS on with no policies, like every public table (0008).
CREATE TABLE "archived_events" (
	"slug" text PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"title" text NOT NULL,
	"night_date" date NOT NULL,
	"metro_slug" text NOT NULL,
	"venue_name" text,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "archived_events" ENABLE ROW LEVEL SECURITY;
