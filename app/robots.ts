// Crawlers (ClaudeBot, 2026-10-17) were walking every filter combination: style x day x type.
// Every filter, day, sort, view and search is a query string, so /*? keeps them off all of them
// while /, /e/<slug> and /bot stay crawlable.

import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/*?"] },
  };
}
