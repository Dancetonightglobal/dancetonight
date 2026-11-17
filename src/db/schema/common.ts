import { timestamp } from "drizzle-orm/pg-core";

/** Every instant is a `timestamptz` (UTC). Tables add a `tz` text column beside instants with a local meaning (D-003). */
export const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Row bookkeeping shared by every mutable table. */
export const timestamps = {
  createdAt: instant("created_at").defaultNow().notNull(),
  updatedAt: instant("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};
