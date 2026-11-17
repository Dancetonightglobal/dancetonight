import {
  pgEnum,
  pgTable,
  uuid,
  text,
  real,
  integer,
  boolean,
  numeric,
  index,
} from "drizzle-orm/pg-core";
import { geography } from "@/src/db/schema/geography";
import { instant, timestamps } from "@/src/db/schema/common";

export const metroStatusEnum = pgEnum("metro_status", ["cold", "warming", "active", "dormant"]);

/** The ingestion unit: a city and its radius (PLAN section 4, section 10). */
export const metros = pgTable(
  "metros",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    countryCode: text("country_code").notNull(),
    center: geography("center").notNull(),
    radiusKm: real("radius_km").notNull(),
    tz: text("tz").notNull(),
    languages: text("languages").array().notNull().default([]),
    geonamesId: integer("geonames_id"),
    population: integer("population"),
    status: metroStatusEnum("status").notNull().default("cold"),
    adHoc: boolean("ad_hoc").notNull().default(false),
    lastDiscoveryAt: instant("last_discovery_at"),
    lastHarvestAt: instant("last_harvest_at"),
    lastTrafficAt: instant("last_traffic_at"),
    /** Per-metro override of the daily budget; null means the global budget applies. */
    budgetDailyUsd: numeric("budget_daily_usd", { precision: 10, scale: 2 }),
    ...timestamps,
  },
  (t) => [
    index("metros_center_gist_idx").using("gist", t.center),
    index("metros_status_idx").on(t.status),
    index("metros_country_code_idx").on(t.countryCode),
  ],
);

/** GeoNames `cities15000` (CC BY 4.0): the offline gazetteer and the seed for lazy metros. */
export const geonamesPlaces = pgTable(
  "geonames_places",
  {
    geonamesId: integer("geonames_id").primaryKey(),
    name: text("name").notNull(),
    asciiName: text("ascii_name").notNull(),
    countryCode: text("country_code").notNull(),
    admin1: text("admin1"),
    population: integer("population"),
    location: geography("location").notNull(),
    tz: text("tz").notNull(),
    createdAt: instant("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("geonames_places_location_gist_idx").using("gist", t.location),
    index("geonames_places_country_ascii_name_idx").on(t.countryCode, t.asciiName),
  ],
);

export type Metro = typeof metros.$inferSelect;
export type NewMetro = typeof metros.$inferInsert;
export type GeonamesPlace = typeof geonamesPlaces.$inferSelect;
