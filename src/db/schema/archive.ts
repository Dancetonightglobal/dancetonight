// Past nights the retention job removed (maintenance M1, the owner 2026-11-16 "1a"): each deleted event's address
// keeps answering, with a "this night has passed" page instead of a bare 404. The event's facts live in the
// monthly archive sheet; this keeps only what the page says. One row per slug, merged rows included, so an old
// merged address also lands here.
import { date, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { instant } from "@/src/db/schema/common";

export const archivedEvents = pgTable("archived_events", {
  slug: text("slug").primaryKey(),
  eventId: uuid("event_id").notNull(),
  title: text("title").notNull(),
  nightDate: date("night_date", { mode: "string" }).notNull(),
  metroSlug: text("metro_slug").notNull(),
  venueName: text("venue_name"),
  archivedAt: instant("archived_at").defaultNow().notNull(),
});
