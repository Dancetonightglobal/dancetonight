import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@/src/db/schema";
import { unquoteGeography } from "@/src/db/unquote-geography";

/** Every table in docs/PLAN.md section 4, by its SQL name. */
const PLAN_TABLES = [
  "metros",
  "geonames_places",
  "venues",
  "osm_places",
  "venue_osm_links",
  "organizers",
  "sources",
  "raw_documents",
  "series",
  "series_exceptions",
  "events",
  "event_sources",
  "field_provenance",
  "merge_decisions",
  "submissions",
  "reports",
  "blocklist",
  "cost_log",
  "budgets",
  "feature_flags",
  "organizer_credentials",
  "job_runs",
  "eval_runs",
  "census_event",
  "census_event_source",
  // Phase 3 (PLAN 8.5, 6.7): the quota ledger's counters and the extraction cache.
  "ai_quota",
  "extraction_cache",
  "link_checks",
] as const;

/** Event fields named in docs/SPEC.md section 3, plus the PLAN section 4 additions. */
const SPEC_EVENT_COLUMNS = [
  "title",
  "listing_type",
  "styles",
  "doors_at",
  "lesson_at",
  "dancing_at",
  "ends_at",
  "tz",
  "prices",
  "is_free",
  "ticket_url",
  "level",
  "partner_required",
  "age_min",
  "dress_code",
  "floor",
  "indoor_outdoor",
  "music",
  "crowd_size_hint",
  "venue_id",
  "organizer_id",
  "series_id",
  "summary",
  "confirmation",
  "confidence",
  "source_ids",
  "first_seen_at",
  "last_verified_at",
];

const PLAN_EVENT_COLUMNS = [
  "starts_at",
  "night_date",
  "geo",
  "metro_id",
  "status",
  "merged_into_id",
  "canonical_url",
  "image",
  "slug",
  "title_normalized",
];

const D028_VENUE_COLUMNS = [
  "overture_id",
  "seed_provider",
  "seed_licence",
  "seed_record_id",
  "socials",
];

const migrationsDir = path.resolve(__dirname, "../../src/db/migrations");
const initSql = readFileSync(path.join(migrationsDir, "0000_init.sql"), "utf8");
/** Every generated migration in journal order: tables added after 0000_init live in later files. */
const allMigrationSql = (
  JSON.parse(readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf8")) as {
    entries: Array<{ tag: string }>;
  }
).entries
  .map((entry) => readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), "utf8"))
  .join("\n");
const extensionsSql = readFileSync(path.join(migrationsDir, "0000_extensions.sql"), "utf8");

const exports: unknown[] = Object.values(schema);
const tables = exports.filter((value): value is PgTable => is(value, PgTable));
const configs = new Map(tables.map((table) => [getTableConfig(table).name, getTableConfig(table)]));

function columnNames(tableName: string): string[] {
  const config = configs.get(tableName);
  if (!config) throw new Error(`No table named ${tableName}`);
  return config.columns.map((column) => column.name);
}

describe("schema tables", () => {
  it("exports exactly the tables in PLAN section 4", () => {
    expect([...configs.keys()].sort()).toEqual([...PLAN_TABLES].sort());
  });

  it("gives every table a primary key", () => {
    for (const [name, config] of configs) {
      const singleColumnKey = config.columns.some((column) => column.primary);
      const compositeKey = config.primaryKeys.length > 0;
      expect(singleColumnKey || compositeKey, `${name} has no primary key`).toBe(true);
    }
  });

  it("uses uuid primary keys with a random default on every row-oriented table", () => {
    // Tables keyed by what they count or cache rather than holding rows of their own: a GeoNames
    // or OSM id, a link pair, a quota counter per provider and day, a cache entry per page hash,
    // a link check per URL (D-768).
    const naturalKeys = new Set([
      "geonames_places",
      "osm_places",
      "venue_osm_links",
      "ai_quota",
      "extraction_cache",
      "link_checks",
    ]);
    for (const [name, config] of configs) {
      if (naturalKeys.has(name)) continue;
      const key = config.columns.find((column) => column.primary);
      expect(key?.name, `${name} primary key`).toBe("id");
      expect(key?.getSQLType(), `${name} id type`).toBe("uuid");
      expect(key?.hasDefault, `${name} id default`).toBe(true);
    }
  });

  it("keeps a tz column beside every table that stores local instants", () => {
    for (const name of [
      "metros",
      "geonames_places",
      "venues",
      "series",
      "events",
      "census_event",
    ]) {
      expect(columnNames(name), `${name}.tz`).toContain("tz");
      const tz = configs.get(name)?.columns.find((column) => column.name === "tz");
      expect(tz?.notNull, `${name}.tz not null`).toBe(true);
    }
  });

  it("stores every instant as timestamptz", () => {
    for (const [name, config] of configs) {
      for (const column of config.columns) {
        if (column.name.endsWith("_at")) {
          expect(column.getSQLType(), `${name}.${column.name}`).toBe("timestamp with time zone");
        }
      }
    }
  });

  it("gives mutable tables created_at and updated_at", () => {
    for (const name of [
      "metros",
      "venues",
      "organizers",
      "sources",
      "series",
      "events",
      "submissions",
    ]) {
      expect(columnNames(name)).toEqual(expect.arrayContaining(["created_at", "updated_at"]));
    }
  });
});

describe("events", () => {
  it("has every field from SPEC section 3", () => {
    expect(columnNames("events")).toEqual(expect.arrayContaining(SPEC_EVENT_COLUMNS));
  });

  it("has the PLAN section 4 additions", () => {
    expect(columnNames("events")).toEqual(expect.arrayContaining(PLAN_EVENT_COLUMNS));
  });

  it("derives starts_at from dancing, lesson and doors in that order", () => {
    const startsAt = configs.get("events")?.columns.find((column) => column.name === "starts_at");
    expect(startsAt?.generated?.type).toBe("always");
    expect(initSql).toContain(
      '"starts_at" timestamp with time zone GENERATED ALWAYS AS (coalesce("dancing_at", "lesson_at", "doors_at")) STORED',
    );
  });

  it("stores night_date as a date and styles as a text array", () => {
    const columns = configs.get("events")?.columns ?? [];
    expect(columns.find((c) => c.name === "night_date")?.getSQLType()).toBe("date");
    expect(columns.find((c) => c.name === "styles")?.getSQLType()).toBe("text[]");
    expect(columns.find((c) => c.name === "source_ids")?.getSQLType()).toBe("uuid[]");
  });

  it("uses the listing_type and confirmation enums from the spec", () => {
    expect(schema.listingTypeEnum.enumValues).toEqual([
      "social",
      "class",
      "club_night",
      "practica",
      "live_music_with_dancing",
      "festival_session",
      "outdoor_public",
      "jam",
      "venue_open_night",
      "other",
    ]);
    expect(schema.confirmationEnum.enumValues).toEqual([
      "confirmed_today",
      "recurring_unconfirmed",
      "conflicting",
      "cancelled",
    ]);
    expect(schema.eventStatusEnum.enumValues).toEqual(["active", "cancelled", "merged", "removed"]);
  });
});

describe("venues and the D-028 split", () => {
  it("carries the per-row seed attribution columns", () => {
    expect(columnNames("venues")).toEqual(expect.arrayContaining(D028_VENUE_COLUMNS));
  });

  it("keeps osm_places keyed by osm type and id, and links through venue_osm_links only", () => {
    expect(configs.get("osm_places")?.primaryKeys[0]?.columns.map((c) => c.name)).toEqual([
      "osm_type",
      "osm_id",
    ]);
    expect(configs.get("venue_osm_links")?.primaryKeys[0]?.columns.map((c) => c.name)).toEqual([
      "venue_id",
      "osm_type",
      "osm_id",
    ]);
    expect(columnNames("venues")).not.toContain("osm_id");
  });

  it("uses geography(Point, 4326) for every point column", () => {
    const points: Array<[string, string]> = [
      ["metros", "center"],
      ["geonames_places", "location"],
      ["venues", "location"],
      ["osm_places", "location"],
      ["events", "geo"],
    ];
    for (const [table, column] of points) {
      const found = configs.get(table)?.columns.find((c) => c.name === column);
      expect(found?.getSQLType(), `${table}.${column}`).toBe("geography(Point, 4326)");
    }
  });
});

describe("enums", () => {
  it("names the values PLAN section 4 lists", () => {
    expect(schema.metroStatusEnum.enumValues).toEqual(["cold", "warming", "active", "dormant"]);
    expect(schema.sourceKindEnum.enumValues).toEqual(
      expect.arrayContaining(["feed_ics", "open_data", "connected", "ticketing_api", "serp"]),
    );
    expect(schema.trustTierEnum.enumValues).toEqual([
      "first_party",
      "ticketing",
      "serp",
      "directory",
      "unofficial",
    ]);
    expect(schema.mergeDecisionEnum.enumValues).toEqual([
      "auto_merge",
      "llm_merge",
      "llm_distinct",
      "queued",
      "manual_merge",
      "manual_distinct",
    ]);
    expect(schema.submissionKindEnum.enumValues).toEqual(["url", "text", "image"]);
    expect(schema.reportKindEnum.enumValues).toEqual([
      "problem",
      "correction",
      "not_dancing",
      "cancelled",
      "duplicate",
      "other",
    ]);
    expect(schema.blocklistPatternTypeEnum.enumValues).toEqual([
      "domain",
      "url_prefix",
      "organizer",
      "venue",
    ]);
    expect(schema.flagScopeEnum.enumValues).toEqual(["global", "metro"]);
    expect(schema.evalKindEnum.enumValues).toEqual(["extraction", "recall"]);
    expect(schema.organizerPlatformEnum.enumValues).toEqual([
      "facebook_page",
      "meetup_group",
      "luma_calendar",
      "studio_api",
    ]);
  });
});

describe("generated migration 0000_init.sql", () => {
  it("creates the GIST indexes on every point column", () => {
    for (const statement of [
      'CREATE INDEX "metros_center_gist_idx" ON "metros" USING gist ("center");',
      'CREATE INDEX "geonames_places_location_gist_idx" ON "geonames_places" USING gist ("location");',
      'CREATE INDEX "venues_location_gist_idx" ON "venues" USING gist ("location");',
      'CREATE INDEX "osm_places_location_gist_idx" ON "osm_places" USING gist ("location");',
      'CREATE INDEX "events_geo_gist_idx" ON "events" USING gist ("geo");',
    ]) {
      expect(initSql).toContain(statement);
    }
  });

  it("creates the pg_trgm GIN indexes on name_normalized and title_normalized", () => {
    expect(initSql).toContain(
      'CREATE INDEX "venues_name_normalized_trgm_idx" ON "venues" USING gin ("name_normalized" gin_trgm_ops);',
    );
    expect(initSql).toContain(
      'CREATE INDEX "organizers_name_normalized_trgm_idx" ON "organizers" USING gin ("name_normalized" gin_trgm_ops);',
    );
    expect(initSql).toContain(
      'CREATE INDEX "events_title_normalized_trgm_idx" ON "events" USING gin ("title_normalized" gin_trgm_ops);',
    );
  });

  it("creates the GIN indexes on styles arrays and the (night_date, starts_at) btree", () => {
    expect(initSql).toContain(
      'CREATE INDEX "events_styles_gin_idx" ON "events" USING gin ("styles");',
    );
    expect(initSql).toContain(
      'CREATE INDEX "series_styles_gin_idx" ON "series" USING gin ("styles");',
    );
    expect(initSql).toContain(
      'CREATE INDEX "events_night_date_starts_at_idx" ON "events" USING btree ("night_date","starts_at");',
    );
  });

  it("creates every table in PLAN section 4 across the migrations", () => {
    for (const table of PLAN_TABLES) {
      expect(allMigrationSql).toContain(`CREATE TABLE "${table}" (`);
    }
  });

  it("writes geography columns as a bare type, not a quoted identifier", () => {
    expect(initSql).not.toMatch(/"geography\(/);
    expect(initSql).toContain('"location" geography(Point, 4326) NOT NULL');
    expect(initSql).toContain('"geo" geography(Point, 4326)');
  });

  it("keeps the unique-with-nulls constraints on budgets and feature flags", () => {
    expect(initSql).toContain(
      'CONSTRAINT "feature_flags_key_scope_metro_id_key" UNIQUE NULLS NOT DISTINCT("key","scope","metro_id")',
    );
    expect(initSql).toContain(
      'CONSTRAINT "budgets_scope_metro_id_key" UNIQUE NULLS NOT DISTINCT("scope","metro_id")',
    );
  });

  it("links venue_osm_links to osm_places with a cascading composite foreign key", () => {
    expect(initSql).toContain(
      'ALTER TABLE "venue_osm_links" ADD CONSTRAINT "venue_osm_links_osm_places_fk" FOREIGN KEY ("osm_type","osm_id") REFERENCES "public"."osm_places"("osm_type","osm_id") ON DELETE cascade',
    );
    const links = configs.get("venue_osm_links");
    const fk = links?.foreignKeys.find((key) => key.getName() === "venue_osm_links_osm_places_fk");
    expect(fk?.reference().foreignTable).toBe(schema.osmPlaces);
    expect(fk?.reference().columns.map((c) => c.name)).toEqual(["osm_type", "osm_id"]);
    expect(fk?.onDelete).toBe("cascade");
  });

  it("restricts deleting a source that event_sources still references", () => {
    expect(initSql).toContain(
      'ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict',
    );
    expect(initSql).not.toMatch(
      /ALTER TABLE "event_sources" [^\n]*REFERENCES "public"\."sources"\("id"\) ON DELETE cascade/,
    );
    const fk = configs
      .get("event_sources")
      ?.foreignKeys.find((key) => key.getName() === "event_sources_source_id_sources_id_fk");
    expect(fk?.onDelete).toBe("restrict");
  });

  it("caps evidence at 300 characters", () => {
    expect(initSql).toContain('CHECK (char_length("field_provenance"."evidence") <= 300)');
    expect(
      configs
        .get("field_provenance")
        ?.checks.map((c) => c.name)
        .includes("field_provenance_evidence_length"),
    ).toBe(true);
  });

  it("allows a listing with a night and no time: 0002 drops the start-time check (D-060)", () => {
    // 0000 created the check; 0002 removes it, and nothing after adds it back.
    expect(initSql).toContain(
      'CHECK (coalesce("events"."dancing_at", "events"."lesson_at", "events"."doors_at") is not null)',
    );
    const dropSql = readFileSync(
      path.join(migrationsDir, "0002_allow_listings_without_a_start_time.sql"),
      "utf8",
    );
    expect(dropSql.trim()).toBe('ALTER TABLE "events" DROP CONSTRAINT "events_has_a_start_time";');
    const afterInit = allMigrationSql.slice(allMigrationSql.indexOf(dropSql));
    expect(afterInit).not.toMatch(/ADD CONSTRAINT "events_has_a_start_time"/);
    // The Drizzle table carries no such check, so the next generated migration cannot restore it.
    expect(configs.get("events")?.checks.map((c) => c.name)).not.toContain(
      "events_has_a_start_time",
    );
    const snapshot = JSON.parse(
      readFileSync(path.join(migrationsDir, "meta/0002_snapshot.json"), "utf8"),
    ) as { tables: Record<string, { checkConstraints: Record<string, unknown> }> };
    const eventChecks = snapshot.tables["public.events"]?.checkConstraints;
    expect(eventChecks).toBeDefined();
    expect(Object.keys(eventChecks ?? {})).not.toContain("events_has_a_start_time");
    // The night stays required: every row still has a date.
    expect(configs.get("events")?.columns.find((c) => c.name === "night_date")?.notNull).toBe(true);
  });
});

describe("extensions step", () => {
  it("creates postgis and pg_trgm idempotently before the generated SQL", () => {
    expect(extensionsSql).toContain("CREATE EXTENSION IF NOT EXISTS postgis;");
    expect(extensionsSql).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
  });

  it("is not in drizzle's journal, so the migrator never runs it twice", () => {
    const journal = JSON.parse(
      readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ tag: string }> };
    const tags = journal.entries.map((entry) => entry.tag);
    expect(tags[0]).toBe("0000_init");
    expect(tags).not.toContain("0000_extensions");
  });
});

describe("unquoteGeography", () => {
  it("rewrites drizzle-kit's quoted custom type and nothing else", () => {
    const input = '"center" "geography(Point, 4326)" NOT NULL,\n\t"name" "some_enum" NOT NULL';
    expect(unquoteGeography(input)).toBe(
      '"center" geography(Point, 4326) NOT NULL,\n\t"name" "some_enum" NOT NULL',
    );
  });

  it("is a no-op on already clean SQL", () => {
    expect(unquoteGeography(initSql)).toBe(initSql);
  });
});
