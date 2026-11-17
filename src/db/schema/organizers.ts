import { sql } from "drizzle-orm";
import { pgEnum, pgTable, uuid, text, jsonb, index } from "drizzle-orm/pg-core";
import { instant, timestamps } from "@/src/db/schema/common";
import { metros } from "@/src/db/schema/metros";

export const organizerPlatformEnum = pgEnum("organizer_platform", [
  "facebook_page",
  "meetup_group",
  "luma_calendar",
  "studio_api",
]);

export const organizers = pgTable(
  "organizers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    nameNormalized: text("name_normalized").notNull(),
    websiteUrl: text("website_url"),
    facebookUrl: text("facebook_url"),
    instagramUrl: text("instagram_url"),
    otherUrls: jsonb("other_urls").$type<string[]>().notNull().default([]),
    /** Taxonomy keys from config/styles.ts. */
    styles: text("styles").array().notNull().default([]),
    metroId: uuid("metro_id").references(() => metros.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("organizers_name_normalized_trgm_idx").using(
      "gin",
      sql`${t.nameNormalized} gin_trgm_ops`,
    ),
    index("organizers_styles_gin_idx").using("gin", t.styles),
    index("organizers_metro_id_idx").on(t.metroId),
  ],
);

/** Reserved for organizer connect (D-019, D-030). Empty in v1. */
export const organizerCredentials = pgTable(
  "organizer_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizerId: uuid("organizer_id")
      .notNull()
      .references(() => organizers.id, { onDelete: "cascade" }),
    platform: organizerPlatformEnum("platform").notNull(),
    /** Ciphertext only; the key lives outside the database. */
    tokenEncrypted: text("token_encrypted").notNull(),
    /** Identifies which key encrypted the token, so keys can rotate. */
    tokenKeyId: text("token_key_id").notNull(),
    scopes: text("scopes").array().notNull().default([]),
    grantedAt: instant("granted_at").notNull(),
    revokedAt: instant("revoked_at"),
    ...timestamps,
  },
  (t) => [index("organizer_credentials_organizer_id_idx").on(t.organizerId)],
);

export type Organizer = typeof organizers.$inferSelect;
export type OrganizerCredential = typeof organizerCredentials.$inferSelect;
