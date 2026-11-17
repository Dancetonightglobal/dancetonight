CREATE TYPE "public"."metro_status" AS ENUM('cold', 'warming', 'active', 'dormant');--> statement-breakpoint
CREATE TYPE "public"."dance_floor" AS ENUM('yes', 'no', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."osm_type" AS ENUM('node', 'way', 'relation');--> statement-breakpoint
CREATE TYPE "public"."venue_kind" AS ENUM('night_club', 'dance_hall', 'studio', 'bar', 'restaurant', 'community_center', 'outdoor', 'other');--> statement-breakpoint
CREATE TYPE "public"."organizer_platform" AS ENUM('facebook_page', 'meetup_group', 'luma_calendar', 'studio_api');--> statement-breakpoint
CREATE TYPE "public"."robots_status" AS ENUM('allowed', 'disallowed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('feed_ics', 'feed_gcal', 'jsonld', 'wp_tribe', 'squarespace', 'wix', 'platform_api', 'open_data', 'html', 'ticketing_api', 'serp', 'directory', 'social_link', 'connected');--> statement-breakpoint
CREATE TYPE "public"."trust_tier" AS ENUM('first_party', 'ticketing', 'serp', 'directory', 'unofficial');--> statement-breakpoint
CREATE TYPE "public"."listing_type" AS ENUM('social', 'class', 'club_night', 'practica', 'live_music_with_dancing', 'festival_session', 'outdoor_public', 'jam', 'venue_open_night', 'other');--> statement-breakpoint
CREATE TYPE "public"."provenance_method" AS ENUM('feed', 'jsonld', 'api', 'llm', 'serp', 'manual');--> statement-breakpoint
CREATE TYPE "public"."series_exception_action" AS ENUM('cancel', 'override');--> statement-breakpoint
CREATE TYPE "public"."confirmation" AS ENUM('confirmed_today', 'recurring_unconfirmed', 'conflicting', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('active', 'cancelled', 'merged', 'removed');--> statement-breakpoint
CREATE TYPE "public"."indoor_outdoor" AS ENUM('indoor', 'outdoor', 'both');--> statement-breakpoint
CREATE TYPE "public"."event_source_role" AS ENUM('primary', 'secondary');--> statement-breakpoint
CREATE TYPE "public"."merge_decision" AS ENUM('auto_merge', 'llm_merge', 'llm_distinct', 'queued', 'manual_merge', 'manual_distinct');--> statement-breakpoint
CREATE TYPE "public"."provenance_entity_type" AS ENUM('event', 'venue', 'organizer', 'series', 'series_exception');--> statement-breakpoint
CREATE TYPE "public"."blocklist_pattern_type" AS ENUM('domain', 'url_prefix', 'organizer', 'venue');--> statement-breakpoint
CREATE TYPE "public"."report_kind" AS ENUM('problem', 'correction', 'not_dancing', 'cancelled', 'duplicate', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."submission_kind" AS ENUM('url', 'text', 'image');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('draft', 'queued', 'approved', 'rejected', 'spam');--> statement-breakpoint
CREATE TYPE "public"."eval_kind" AS ENUM('extraction', 'recall');--> statement-breakpoint
CREATE TYPE "public"."flag_scope" AS ENUM('global', 'metro');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "geonames_places" (
	"geonames_id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"ascii_name" text NOT NULL,
	"country_code" text NOT NULL,
	"admin1" text,
	"population" integer,
	"location" geography(Point, 4326) NOT NULL,
	"tz" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"country_code" text NOT NULL,
	"center" geography(Point, 4326) NOT NULL,
	"radius_km" real NOT NULL,
	"tz" text NOT NULL,
	"languages" text[] DEFAULT '{}' NOT NULL,
	"geonames_id" integer,
	"population" integer,
	"status" "metro_status" DEFAULT 'cold' NOT NULL,
	"ad_hoc" boolean DEFAULT false NOT NULL,
	"last_discovery_at" timestamp with time zone,
	"last_harvest_at" timestamp with time zone,
	"last_traffic_at" timestamp with time zone,
	"budget_daily_usd" numeric(10, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metros_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "osm_places" (
	"osm_type" "osm_type" NOT NULL,
	"osm_id" bigint NOT NULL,
	"tags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"location" geography(Point, 4326) NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"licence" text DEFAULT 'ODbL-1.0' NOT NULL,
	CONSTRAINT "osm_places_pkey" PRIMARY KEY("osm_type","osm_id")
);
--> statement-breakpoint
CREATE TABLE "venue_osm_links" (
	"venue_id" uuid NOT NULL,
	"osm_type" "osm_type" NOT NULL,
	"osm_id" bigint NOT NULL,
	"method" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_osm_links_pkey" PRIMARY KEY("venue_id","osm_type","osm_id")
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"location" geography(Point, 4326) NOT NULL,
	"address" jsonb,
	"neighborhood" text,
	"tz" text NOT NULL,
	"overture_id" text,
	"seed_provider" text,
	"seed_licence" text,
	"seed_record_id" text,
	"google_place_id" text,
	"website_url" text,
	"socials" jsonb,
	"kind" "venue_kind" DEFAULT 'other' NOT NULL,
	"dance_floor" "dance_floor" DEFAULT 'unknown' NOT NULL,
	"hours" jsonb,
	"hours_fetched_at" timestamp with time zone,
	"photo" jsonb,
	"classified_from_url" text,
	"classification_confidence" real,
	"metro_id" uuid,
	"blocklisted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_overture_id_unique" UNIQUE("overture_id"),
	CONSTRAINT "venues_google_place_id_unique" UNIQUE("google_place_id")
);
--> statement-breakpoint
CREATE TABLE "organizer_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizer_id" uuid NOT NULL,
	"platform" "organizer_platform" NOT NULL,
	"token_encrypted" text NOT NULL,
	"token_key_id" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"website_url" text,
	"facebook_url" text,
	"instagram_url" text,
	"other_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"styles" text[] DEFAULT '{}' NOT NULL,
	"metro_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"url" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"http_status" integer,
	"etag" text,
	"content_hash" text NOT NULL,
	"cleaned_text" text,
	"extraction_method" text,
	"model" text,
	"cost_usd" numeric(12, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"platform" text,
	"country_codes" text[] DEFAULT '{}' NOT NULL,
	"feed_url" text,
	"organizer_id" uuid,
	"venue_id" uuid,
	"metro_id" uuid,
	"styles" text[] DEFAULT '{}' NOT NULL,
	"language" text,
	"trust_tier" "trust_tier" NOT NULL,
	"robots_status" "robots_status" DEFAULT 'unknown' NOT NULL,
	"robots_checked_at" timestamp with time zone,
	"crawl_delay_s" real,
	"enabled" boolean DEFAULT true NOT NULL,
	"health" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"discovered_by" text,
	"next_harvest_at" timestamp with time zone,
	"etag" text,
	"last_modified" text,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"organizer_id" uuid,
	"venue_id" uuid,
	"metro_id" uuid,
	"rrule" text NOT NULL,
	"tz" text NOT NULL,
	"listing_type" "listing_type" NOT NULL,
	"styles" text[] DEFAULT '{}' NOT NULL,
	"defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_confirmed_at" timestamp with time zone,
	"confidence" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"night_date" date NOT NULL,
	"action" "series_exception_action" NOT NULL,
	"override" jsonb,
	"source_id" uuid,
	"source_url" text,
	"fetched_at" timestamp with time zone,
	"evidence" text,
	"method" "provenance_method" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "series_exceptions_series_id_night_date_key" UNIQUE("series_id","night_date")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"title_normalized" text NOT NULL,
	"listing_type" "listing_type" NOT NULL,
	"styles" text[] DEFAULT '{}' NOT NULL,
	"doors_at" timestamp with time zone,
	"lesson_at" timestamp with time zone,
	"dancing_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"starts_at" timestamp with time zone GENERATED ALWAYS AS (coalesce("dancing_at", "lesson_at", "doors_at")) STORED,
	"night_date" date NOT NULL,
	"tz" text NOT NULL,
	"geo" geography(Point, 4326),
	"prices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_free" boolean,
	"ticket_url" text,
	"level" text,
	"partner_required" boolean,
	"age_min" integer,
	"dress_code" text,
	"floor" text,
	"indoor_outdoor" "indoor_outdoor",
	"music" jsonb,
	"crowd_size_hint" text,
	"venue_id" uuid,
	"organizer_id" uuid,
	"series_id" uuid,
	"metro_id" uuid,
	"summary" text,
	"confirmation" "confirmation" NOT NULL,
	"confidence" real,
	"source_ids" uuid[] DEFAULT '{}' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" "event_status" DEFAULT 'active' NOT NULL,
	"merged_into_id" uuid,
	"canonical_url" text,
	"image" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug"),
	CONSTRAINT "events_has_a_start_time" CHECK (coalesce("events"."dancing_at", "events"."lesson_at", "events"."doors_at") is not null)
);
--> statement-breakpoint
CREATE TABLE "event_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"source_url" text NOT NULL,
	"raw_document_id" uuid,
	"role" "event_source_role" DEFAULT 'secondary' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_sources_event_source_url_key" UNIQUE("event_id","source_id","source_url")
);
--> statement-breakpoint
CREATE TABLE "field_provenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "provenance_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"field" text NOT NULL,
	"value" jsonb NOT NULL,
	"source_id" uuid,
	"source_url" text,
	"fetched_at" timestamp with time zone NOT NULL,
	"evidence" text,
	"method" "provenance_method" NOT NULL,
	"model" text,
	"confidence" real,
	"is_current" boolean DEFAULT true NOT NULL,
	"conflicts_with" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_provenance_evidence_length" CHECK (char_length("field_provenance"."evidence") <= 300)
);
--> statement-breakpoint
CREATE TABLE "merge_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_a" uuid NOT NULL,
	"event_b" uuid NOT NULL,
	"score" real NOT NULL,
	"decision" "merge_decision" NOT NULL,
	"reasoning" text,
	"cost_usd" numeric(12, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocklist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pattern_type" "blocklist_pattern_type" NOT NULL,
	"value" text NOT NULL,
	"reason" text,
	"requested_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocklist_pattern_type_value_key" UNIQUE("pattern_type","value")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" "report_kind" NOT NULL,
	"message" text,
	"proposed" jsonb,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"contact" text,
	"ip_hash" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "submission_kind" NOT NULL,
	"input" jsonb NOT NULL,
	"storage_path" text,
	"draft" jsonb,
	"confirmed_draft" jsonb,
	"status" "submission_status" DEFAULT 'draft' NOT NULL,
	"rights_confirmed" boolean DEFAULT false NOT NULL,
	"contact" text,
	"ip_hash" text,
	"metro_id" uuid,
	"resulting_event_id" uuid,
	"moderated_at" timestamp with time zone,
	"moderation_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "flag_scope" NOT NULL,
	"metro_id" uuid,
	"daily_usd" numeric(10, 2) NOT NULL,
	"monthly_usd" numeric(10, 2) NOT NULL,
	"hard_stop" boolean DEFAULT true NOT NULL,
	"alert_at_pct" integer DEFAULT 80 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_scope_metro_id_key" UNIQUE NULLS NOT DISTINCT("scope","metro_id")
);
--> statement-breakpoint
CREATE TABLE "cost_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"run_id" uuid,
	"metro_id" uuid,
	"source_id" uuid,
	"provider" text NOT NULL,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"requests" integer DEFAULT 1 NOT NULL,
	"usd" numeric(12, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "eval_kind" NOT NULL,
	"metro_id" uuid,
	"date" date,
	"metrics" jsonb NOT NULL,
	"report_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"scope" "flag_scope" DEFAULT 'global' NOT NULL,
	"metro_id" uuid,
	"value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flags_key_scope_metro_id_key" UNIQUE NULLS NOT DISTINCT("key","scope","metro_id")
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"external_run_id" text,
	"metro_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "job_status" DEFAULT 'running' NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "census_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metro_id" uuid NOT NULL,
	"night_date" date NOT NULL,
	"tz" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"venue_name" text,
	"venue_id" uuid,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"price" text,
	"recurrence" text,
	"canonical_url" text,
	"platforms" text[] DEFAULT '{}' NOT NULL,
	"verification_method" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "census_event_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"census_event_id" uuid NOT NULL,
	"source_label" text NOT NULL,
	"source_id" uuid,
	"found" boolean NOT NULL,
	"found_how" text,
	"discovered_here_first" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "census_event_source_event_label_key" UNIQUE("census_event_id","source_label")
);
--> statement-breakpoint
ALTER TABLE "venue_osm_links" ADD CONSTRAINT "venue_osm_links_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_osm_links" ADD CONSTRAINT "venue_osm_links_osm_places_fk" FOREIGN KEY ("osm_type","osm_id") REFERENCES "public"."osm_places"("osm_type","osm_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_metro_id_metros_id_fk" FOREIGN KEY ("metro_id") REFERENCES "public"."metros"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_credentials" ADD CONSTRAINT "organizer_credentials_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizers" ADD CONSTRAINT "organizers_metro_id_metros_id_fk" FOREIGN KEY ("metro_id") REFERENCES "public"."metros"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_documents" ADD CONSTRAINT "raw_documents_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_metro_id_metros_id_fk" FOREIGN KEY ("metro_id") REFERENCES "public"."metros"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_metro_id_metros_id_fk" FOREIGN KEY ("metro_id") REFERENCES "public"."metros"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_exceptions" ADD CONSTRAINT "series_exceptions_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_exceptions" ADD CONSTRAINT "series_exceptions_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_metro_id_metros_id_fk" FOREIGN KEY ("metro_id") REFERENCES "public"."metros"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_merged_into_id_events_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_raw_document_id_raw_documents_id_fk" FOREIGN KEY ("raw_document_id") REFERENCES "public"."raw_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_provenance" ADD CONSTRAINT "field_provenance_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_provenance" ADD CONSTRAINT "field_provenance_conflicts_with_field_provenance_id_fk" FOREIGN KEY ("conflicts_with") REFERENCES "public"."field_provenance"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_decisions" ADD CONSTRAINT "merge_decisions_event_a_events_id_fk" FOREIGN KEY ("event_a") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_decisions" ADD CONSTRAINT "merge_decisions_event_b_events_id_fk" FOREIGN KEY ("event_b") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_metro_id_metros_id_fk" FOREIGN KEY ("metro_id") REFERENCES "public"."metros"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_resulting_event_id_events_id_fk" FOREIGN KEY ("resulting_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_metro_id_metros_id_fk" FOREIGN KEY ("metro_id") REFERENCES "public"."metros"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_log" ADD CONSTRAINT "cost_log_run_id_job_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."job_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_log" ADD CONSTRAINT "cost_log_metro_id_metros_id_fk" FOREIGN KEY ("metro_id") REFERENCES "public"."metros"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_log" ADD CONSTRAINT "cost_log_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_metro_id_metros_id_fk" FOREIGN KEY ("metro_id") REFERENCES "public"."metros"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_metro_id_metros_id_fk" FOREIGN KEY ("metro_id") REFERENCES "public"."metros"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_metro_id_metros_id_fk" FOREIGN KEY ("metro_id") REFERENCES "public"."metros"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "census_event" ADD CONSTRAINT "census_event_metro_id_metros_id_fk" FOREIGN KEY ("metro_id") REFERENCES "public"."metros"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "census_event" ADD CONSTRAINT "census_event_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "census_event_source" ADD CONSTRAINT "census_event_source_census_event_id_census_event_id_fk" FOREIGN KEY ("census_event_id") REFERENCES "public"."census_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "census_event_source" ADD CONSTRAINT "census_event_source_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "geonames_places_location_gist_idx" ON "geonames_places" USING gist ("location");--> statement-breakpoint
CREATE INDEX "geonames_places_country_ascii_name_idx" ON "geonames_places" USING btree ("country_code","ascii_name");--> statement-breakpoint
CREATE INDEX "metros_center_gist_idx" ON "metros" USING gist ("center");--> statement-breakpoint
CREATE INDEX "metros_status_idx" ON "metros" USING btree ("status");--> statement-breakpoint
CREATE INDEX "metros_country_code_idx" ON "metros" USING btree ("country_code");--> statement-breakpoint
CREATE INDEX "osm_places_location_gist_idx" ON "osm_places" USING gist ("location");--> statement-breakpoint
CREATE INDEX "venue_osm_links_osm_idx" ON "venue_osm_links" USING btree ("osm_type","osm_id");--> statement-breakpoint
CREATE INDEX "venues_location_gist_idx" ON "venues" USING gist ("location");--> statement-breakpoint
CREATE INDEX "venues_name_normalized_trgm_idx" ON "venues" USING gin ("name_normalized" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "venues_metro_id_idx" ON "venues" USING btree ("metro_id");--> statement-breakpoint
CREATE INDEX "organizer_credentials_organizer_id_idx" ON "organizer_credentials" USING btree ("organizer_id");--> statement-breakpoint
CREATE INDEX "organizers_name_normalized_trgm_idx" ON "organizers" USING gin ("name_normalized" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "organizers_styles_gin_idx" ON "organizers" USING gin ("styles");--> statement-breakpoint
CREATE INDEX "organizers_metro_id_idx" ON "organizers" USING btree ("metro_id");--> statement-breakpoint
CREATE INDEX "raw_documents_source_id_fetched_at_idx" ON "raw_documents" USING btree ("source_id","fetched_at");--> statement-breakpoint
CREATE INDEX "raw_documents_content_hash_idx" ON "raw_documents" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "sources_metro_id_idx" ON "sources" USING btree ("metro_id");--> statement-breakpoint
CREATE INDEX "sources_organizer_id_idx" ON "sources" USING btree ("organizer_id");--> statement-breakpoint
CREATE INDEX "sources_venue_id_idx" ON "sources" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "sources_next_harvest_at_idx" ON "sources" USING btree ("next_harvest_at");--> statement-breakpoint
CREATE INDEX "sources_kind_idx" ON "sources" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "series_venue_id_idx" ON "series" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "series_organizer_id_idx" ON "series" USING btree ("organizer_id");--> statement-breakpoint
CREATE INDEX "series_metro_id_idx" ON "series" USING btree ("metro_id");--> statement-breakpoint
CREATE INDEX "series_styles_gin_idx" ON "series" USING gin ("styles");--> statement-breakpoint
CREATE INDEX "events_geo_gist_idx" ON "events" USING gist ("geo");--> statement-breakpoint
CREATE INDEX "events_night_date_starts_at_idx" ON "events" USING btree ("night_date","starts_at");--> statement-breakpoint
CREATE INDEX "events_styles_gin_idx" ON "events" USING gin ("styles");--> statement-breakpoint
CREATE INDEX "events_title_normalized_trgm_idx" ON "events" USING gin ("title_normalized" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "events_metro_id_night_date_idx" ON "events" USING btree ("metro_id","night_date");--> statement-breakpoint
CREATE INDEX "events_venue_id_idx" ON "events" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "events_series_id_night_date_idx" ON "events" USING btree ("series_id","night_date");--> statement-breakpoint
CREATE INDEX "event_sources_source_id_idx" ON "event_sources" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "field_provenance_entity_field_idx" ON "field_provenance" USING btree ("entity_type","entity_id","field");--> statement-breakpoint
CREATE INDEX "field_provenance_source_id_idx" ON "field_provenance" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "merge_decisions_event_a_idx" ON "merge_decisions" USING btree ("event_a");--> statement-breakpoint
CREATE INDEX "merge_decisions_event_b_idx" ON "merge_decisions" USING btree ("event_b");--> statement-breakpoint
CREATE INDEX "merge_decisions_decision_idx" ON "merge_decisions" USING btree ("decision");--> statement-breakpoint
CREATE INDEX "reports_event_id_idx" ON "reports" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "reports_status_created_at_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "submissions_status_created_at_idx" ON "submissions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "submissions_ip_hash_idx" ON "submissions" USING btree ("ip_hash");--> statement-breakpoint
CREATE INDEX "cost_log_created_at_idx" ON "cost_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "cost_log_metro_id_created_at_idx" ON "cost_log" USING btree ("metro_id","created_at");--> statement-breakpoint
CREATE INDEX "cost_log_run_id_idx" ON "cost_log" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "eval_runs_kind_created_at_idx" ON "eval_runs" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "job_runs_job_started_at_idx" ON "job_runs" USING btree ("job","started_at");--> statement-breakpoint
CREATE INDEX "job_runs_metro_id_idx" ON "job_runs" USING btree ("metro_id");--> statement-breakpoint
CREATE INDEX "census_event_metro_id_night_date_idx" ON "census_event" USING btree ("metro_id","night_date");--> statement-breakpoint
CREATE INDEX "census_event_source_source_id_idx" ON "census_event_source" USING btree ("source_id");