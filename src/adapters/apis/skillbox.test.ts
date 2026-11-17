import { describe, expect, it } from "vitest";
import { createPoliteHttp, type TransportRequest } from "@/src/pipeline/http";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import {
  isSkillboxDanceNight,
  skillboxDetailToListing,
  skillboxAdapter,
  SKILLBOX_LIST_URL,
  SKILLBOX_DETAILS_URL,
  SKILLBOX_CITIES,
  MAX_SKILLBOX_LIST_PAGES,
  MAX_SKILLBOX_DETAILS,
} from "@/src/adapters/apis/skillbox";

const NOW = new Date("2026-10-31T12:00:00Z");
const TONIGHT = "2026-10-31";

const MUMBAI: Metro = {
  id: "m",
  slug: "mumbai",
  name: "Mumbai",
  countryCode: "IN",
  center: { lat: 19.076, lng: 72.8777 },
  radiusKm: 40,
  tz: "Asia/Kolkata",
  languages: ["en"],
};

const SOURCE: Source = {
  id: "s",
  url: "https://www.skillboxes.com/",
  kind: "platform_api",
  trustTier: "directory",
  platform: "skillbox",
  feedUrl: null,
  metroId: "m",
  styles: ["techno", "house"],
  etag: null,
  lastModified: null,
  contentHash: null,
};

describe("isSkillboxDanceNight", () => {
  it("returns true for techno club gig", () => {
    const item = {
      category: "Club Gigs - Music",
      subcategories: [{ name: "Techno" }, { name: "Electronic" }],
    };
    expect(isSkillboxDanceNight(item)).toBe(true);
  });

  it("returns false for metal gig", () => {
    const item = {
      category: "Club Gigs - Music",
      subcategories: [{ name: "Progressive Metal" }],
    };
    expect(isSkillboxDanceNight(item)).toBe(false);
  });

  it("returns false for live music", () => {
    const item = {
      category: "Club Gigs - Music",
      subcategories: [{ name: "Live Music" }],
    };
    expect(isSkillboxDanceNight(item)).toBe(false);
  });

  it("returns true for Diwali party", () => {
    const item = {
      category: "Diwali 2026",
      subcategories: [{ name: "Diwali Party" }],
    };
    expect(isSkillboxDanceNight(item)).toBe(true);
  });

  it("returns false for classical dance", () => {
    const item = {
      category: "Dance",
      subcategories: [{ name: "Classical Dance" }],
    };
    expect(isSkillboxDanceNight(item)).toBe(false);
  });
});

describe("skillboxAdapter harvest with multiple cities", () => {
  const DELHI: Metro = {
    id: "d",
    slug: "delhi",
    name: "Delhi",
    countryCode: "IN",
    center: { lat: 28.6139, lng: 77.209 },
    radiusKm: 40,
    tz: "Asia/Kolkata",
    languages: ["en"],
  };

  it("reads every city id for the metro and keeps an event both cities list once", async () => {
    const seenBodies: string[] = [];
    const seenDetailSlugs: string[] = [];
    let t = NOW.getTime();
    const ctx: RunCtx = {
      metro: DELHI,
      now: () => new Date(t),
      env: {},
      log: () => {},
      http: createPoliteHttp({
        userAgent: "test",
        now: () => t,
        sleep: async (ms) => {
          t += ms;
        },
        transport: async (req) => {
          if (req.url === "https://www.skillboxes.com/robots.txt") {
            return {
              url: req.url,
              status: 200,
              headers: {},
              body: "User-agent: *\nDisallow: /admin/\n",
            };
          }
          if (req.url === SKILLBOX_LIST_URL && req.method === "POST") {
            const body = req.body as string;
            seenBodies.push(body);
            const parsed = JSON.parse(body);
            if (parsed.city === 2) {
              return {
                url: req.url,
                status: 200,
                headers: {},
                body: JSON.stringify({
                  success: true,
                  next: false,
                  items: [
                    {
                      EventId: 1,
                      slug: "a",
                      category: "Club Gigs - Music",
                      subcategories: [{ name: "Techno" }],
                    },
                    {
                      EventId: 2,
                      slug: "b",
                      category: "Club Gigs - Music",
                      subcategories: [{ name: "Techno" }],
                    },
                  ],
                }),
              };
            } else if (parsed.city === 3) {
              return {
                url: req.url,
                status: 200,
                headers: {},
                body: JSON.stringify({
                  success: true,
                  next: false,
                  items: [
                    {
                      EventId: 2,
                      slug: "b",
                      category: "Club Gigs - Music",
                      subcategories: [{ name: "Techno" }],
                    },
                    {
                      EventId: 3,
                      slug: "c",
                      category: "Club Gigs - Music",
                      subcategories: [{ name: "Techno" }],
                    },
                  ],
                }),
              };
            }
          }
          if (req.url === SKILLBOX_DETAILS_URL && req.method === "POST") {
            const body = req.body as string;
            const { slug } = JSON.parse(body);
            seenDetailSlugs.push(slug);
            return {
              url: req.url,
              status: 200,
              headers: {},
              body: JSON.stringify({
                success: true,
                data: {
                  event_display_name: slug,
                  slug,
                  starttime_ldjson: "2026-11-01T22:00:00",
                  endtime_ldjson: "2026-11-02T02:00:00",
                  venue_name: "Club",
                  venue_address: "Address",
                  venue_latitude: "19.123456",
                  venue_longitude: "72.123456",
                  min_price: 500,
                  max_price: 1000,
                  status: 1,
                  share_url: `https://www.skillboxes.com/events/${slug}`,
                },
              }),
            };
          }
          throw new Error(`Unexpected request: ${req.url}`);
        },
      }),
    };
    const SOURCE_DELHI: Source = {
      ...SOURCE,
      metroId: "d",
    };
    const result = await skillboxAdapter.harvest!(SOURCE_DELHI, ctx);
    // Check list bodies
    expect(seenBodies[0]).toBe('{"opcode":"search","type":"upcoming","page":1,"city":2}');
    expect(seenBodies[1]).toBe('{"opcode":"search","type":"upcoming","page":1,"city":3}');
    // Check detail slugs
    expect(seenDetailSlugs).toEqual(["a", "b", "c"]);
    // Should have 3 listings
    expect(result.listings).toHaveLength(3);
  });

  it("a failed city does not stop the next city", async () => {
    const seenBodies: string[] = [];
    let t = NOW.getTime();
    const ctx: RunCtx = {
      metro: DELHI,
      now: () => new Date(t),
      env: {},
      log: () => {},
      http: createPoliteHttp({
        userAgent: "test",
        now: () => t,
        sleep: async (ms) => {
          t += ms;
        },
        transport: async (req) => {
          if (req.url === "https://www.skillboxes.com/robots.txt") {
            return {
              url: req.url,
              status: 200,
              headers: {},
              body: "User-agent: *\nDisallow: /admin/\n",
            };
          }
          if (req.url === SKILLBOX_LIST_URL && req.method === "POST") {
            const body = req.body as string;
            seenBodies.push(body);
            const parsed = JSON.parse(body);
            if (parsed.city === 2) {
              return {
                url: req.url,
                status: 200,
                headers: {},
                body: JSON.stringify({
                  success: false,
                  items: [],
                }),
              };
            } else if (parsed.city === 3) {
              return {
                url: req.url,
                status: 200,
                headers: {},
                body: JSON.stringify({
                  success: true,
                  next: false,
                  items: [
                    {
                      EventId: 1,
                      slug: "only",
                      category: "Club Gigs - Music",
                      subcategories: [{ name: "Techno" }],
                    },
                  ],
                }),
              };
            }
          }
          if (req.url === SKILLBOX_DETAILS_URL && req.method === "POST") {
            const body = req.body as string;
            const { slug } = JSON.parse(body);
            return {
              url: req.url,
              status: 200,
              headers: {},
              body: JSON.stringify({
                success: true,
                data: {
                  event_display_name: slug,
                  slug,
                  starttime_ldjson: "2026-11-01T22:00:00",
                  endtime_ldjson: "2026-11-02T02:00:00",
                  venue_name: "Club",
                  venue_address: "Address",
                  venue_latitude: "19.123456",
                  venue_longitude: "72.123456",
                  min_price: 500,
                  max_price: 1000,
                  status: 1,
                  share_url: `https://www.skillboxes.com/events/${slug}`,
                },
              }),
            };
          }
          throw new Error(`Unexpected request: ${req.url}`);
        },
      }),
    };
    const SOURCE_DELHI: Source = {
      ...SOURCE,
      metroId: "d",
    };
    const result = await skillboxAdapter.harvest!(SOURCE_DELHI, ctx);
    expect(result.listings).toHaveLength(1);
    // The note about city 2 failure should be present
    const city2Note = (result.notes ?? []).find((note) => note.includes("city 2"));
    expect(city2Note).toBeDefined();
    // Check it's the right note
    if (city2Note) {
      expect(city2Note).toMatch(/list page 1 of city 2 did not succeed/);
    }
  });

  it("the list page cap counts all cities", async () => {
    const seenBodies: string[] = [];
    let t = NOW.getTime();
    const ctx: RunCtx = {
      metro: DELHI,
      now: () => new Date(t),
      env: {},
      log: () => {},
      http: createPoliteHttp({
        userAgent: "test",
        now: () => t,
        sleep: async (ms) => {
          t += ms;
        },
        transport: async (req) => {
          if (req.url === "https://www.skillboxes.com/robots.txt") {
            return {
              url: req.url,
              status: 200,
              headers: {},
              body: "User-agent: *\nDisallow: /admin/\n",
            };
          }
          if (req.url === SKILLBOX_LIST_URL && req.method === "POST") {
            const body = req.body as string;
            seenBodies.push(body);
            return {
              url: req.url,
              status: 200,
              headers: {},
              body: JSON.stringify({
                success: true,
                next: true,
                items: [
                  {
                    EventId: seenBodies.length,
                    slug: `event-${seenBodies.length}`,
                    category: "Club Gigs - Music",
                    subcategories: [{ name: "Techno" }],
                  },
                ],
              }),
            };
          }
          // We won't reach detail requests because we're testing list cap
          throw new Error(`Unexpected request: ${req.url}`);
        },
      }),
    };
    const SOURCE_DELHI: Source = {
      ...SOURCE,
      metroId: "d",
    };
    // The harvest will stop when totalListRequests reaches MAX_SKILLBOX_LIST_PAGES
    await skillboxAdapter.harvest!(SOURCE_DELHI, ctx);
    expect(seenBodies).toHaveLength(MAX_SKILLBOX_LIST_PAGES);
    // First requests should be for city 2, then city 3
    const city2Requests = seenBodies.filter((b) => b.includes('"city":2')).length;
    const city3Requests = seenBodies.filter((b) => b.includes('"city":3')).length;
    expect(city2Requests + city3Requests).toBe(MAX_SKILLBOX_LIST_PAGES);
  });
});

describe("skillboxDetailToListing", () => {
  const options = {
    fetchedAt: NOW,
    metroTz: "Asia/Kolkata",
    fromNight: TONIGHT,
    days: 14,
  };

  it("maps a valid detail to listing", () => {
    const data = {
      event_display_name: "Victor Ruiz at antiSocial Mumbai",
      slug: "victor-ruiz-at-antisocial-mumbai-sbykbqtc",
      starttime_ldjson: "2026-11-13T21:00:00",
      endtime_ldjson: "2026-11-13T23:59:00",
      venue_name: "antiSOCIAL Lower Parel",
      venue_address:
        "Plot 242, Mathuradas Mill Compound, Sitaram Jadhav Marg, Lower Parel, Mumbai, Maharashtra 400013, India",
      venue_latitude: "18.9992337",
      venue_longitude: "72.83030409999999",
      min_price: 1000,
      max_price: 4000,
      status: 1,
      share_url: "https://www.skillboxes.com/events/victor-ruiz-at-antisocial-mumbai-sbykbqtc",
      category_name: "Club Gigs - Music",
      city_name: "Mumbai",
    };
    const result = skillboxDetailToListing(data, options);
    expect(result.listing).toBeDefined();
    expect(result.note).toBeNull();
    expect(result.startMoved).toBe(false);
    const listing = result.listing!;
    expect(listing.externalId).toBe("skillbox:victor-ruiz-at-antisocial-mumbai-sbykbqtc");
    expect(listing.listing.local_date).toBe("2026-11-13");
    expect(listing.listing.doors_time).toBe("21:00");
    expect(listing.listing.end_time).toBe("23:59");
    expect(listing.listing.venue.name).toBe("antiSOCIAL Lower Parel");
    expect(listing.listing.prices?.[0]?.label).toBe("From");
    expect(listing.listing.prices?.[0]?.amount).toBe(1000);
    expect(listing.listing.prices?.[0]?.currency).toBe("INR");
    expect(listing.venueLocation?.lat).toBeCloseTo(18.9992337);
    expect(listing.venueLocation?.lng).toBeCloseTo(72.83030409999999);
  });

  it("handles placeholder coords and string prices", () => {
    const data = {
      event_display_name: "Test",
      slug: "test",
      starttime_ldjson: "2026-11-13T21:00:00",
      endtime_ldjson: "2026-11-13T23:59:00",
      venue_name: "Test",
      venue_address: "",
      venue_latitude: "19",
      venue_longitude: "72",
      min_price: "0",
      max_price: "399",
      status: 1,
      share_url: "https://www.skillboxes.com/events/test",
    };
    const result = skillboxDetailToListing(data, options);
    expect(result.listing).toBeDefined();
    const listing = result.listing!;
    expect(listing.venueLocation).toBeNull();
    expect(listing.listing.prices?.[0]?.label).toBe("Tickets");
    expect(listing.listing.prices?.[0]?.amount).toBe(399);
  });

  it("returns null for start outside window", () => {
    const data = {
      event_display_name: "Future",
      slug: "future",
      starttime_ldjson: "2027-01-09T21:00:00",
      endtime_ldjson: "2027-01-09T23:59:00",
      venue_name: "Test",
      venue_address: "",
      venue_latitude: "19",
      venue_longitude: "72",
      min_price: 0,
      max_price: 0,
      status: 1,
      share_url: "https://www.skillboxes.com/events/future",
    };
    const result = skillboxDetailToListing(data, options);
    expect(result.listing).toBeNull();
    expect(result.note).toBeNull();
  });

  it("marks cancelled when status !== 1", () => {
    const data = {
      event_display_name: "Cancelled",
      slug: "cancelled",
      starttime_ldjson: "2026-11-13T21:00:00",
      endtime_ldjson: "2026-11-13T23:59:00",
      venue_name: "Test",
      venue_address: "",
      venue_latitude: "19",
      venue_longitude: "72",
      min_price: 0,
      max_price: 0,
      status: 0,
      share_url: "https://www.skillboxes.com/events/cancelled",
    };
    const result = skillboxDetailToListing(data, options);
    expect(result.listing).toBeDefined();
    expect(result.listing!.listing.cancelled).toBe(true);
    expect(result.startMoved).toBe(false);
  });

  it("adjusts AM/PM confusion: 08:30 start, 01:30 next day", () => {
    const data = {
      event_display_name: "DDLJ Party",
      slug: "ddlj-party",
      starttime_ldjson: "2026-11-04T08:30:00",
      endtime_ldjson: "2026-11-05T01:30:00",
      venue_name: "Test Venue",
      venue_address: "Address",
      venue_latitude: "19.123456",
      venue_longitude: "72.123456",
      min_price: 500,
      max_price: 1000,
      status: 1,
      share_url: "https://www.skillboxes.com/events/ddlj-party",
    };
    const result = skillboxDetailToListing(data, options);
    expect(result.listing).toBeDefined();
    expect(result.startMoved).toBe(true);
    const listing = result.listing!;
    expect(listing.listing.local_date).toBe("2026-11-04");
    expect(listing.listing.doors_time).toBe("20:30");
    expect(listing.listing.end_time).toBe("01:30");
    expect(listing.listing.evidence.startMoved).toContain("organiser AM/PM");
  });

  it("does not adjust when end is same day", () => {
    const data = {
      event_display_name: "Same Day",
      slug: "same-day",
      starttime_ldjson: "2026-11-04T10:00:00",
      endtime_ldjson: "2026-11-04T13:00:00",
      venue_name: "Test",
      venue_address: "",
      venue_latitude: "19",
      venue_longitude: "72",
      min_price: 0,
      max_price: 0,
      status: 1,
      share_url: "https://www.skillboxes.com/events/same-day",
    };
    const result = skillboxDetailToListing(data, options);
    expect(result.listing).toBeDefined();
    expect(result.startMoved).toBe(false);
    const listing = result.listing!;
    expect(listing.listing.doors_time).toBe("10:00");
  });

  it("does not adjust when end after 06:00 next day", () => {
    const data = {
      event_display_name: "Late End",
      slug: "late-end",
      starttime_ldjson: "2026-11-04T08:00:00",
      endtime_ldjson: "2026-11-05T07:00:00",
      venue_name: "Test",
      venue_address: "",
      venue_latitude: "19",
      venue_longitude: "72",
      min_price: 0,
      max_price: 0,
      status: 1,
      share_url: "https://www.skillboxes.com/events/late-end",
    };
    const result = skillboxDetailToListing(data, options);
    expect(result.listing).toBeDefined();
    expect(result.startMoved).toBe(false);
    const listing = result.listing!;
    expect(listing.listing.doors_time).toBe("08:00");
  });

  it("adjusts 11:00 to 23:00 when end 02:00 next day", () => {
    const data = {
      event_display_name: "Late Night",
      slug: "late-night",
      starttime_ldjson: "2026-11-04T11:00:00",
      endtime_ldjson: "2026-11-05T02:00:00",
      venue_name: "Test",
      venue_address: "",
      venue_latitude: "19",
      venue_longitude: "72",
      min_price: 0,
      max_price: 0,
      status: 1,
      share_url: "https://www.skillboxes.com/events/late-night",
    };
    const result = skillboxDetailToListing(data, options);
    expect(result.listing).toBeDefined();
    expect(result.startMoved).toBe(true);
    const listing = result.listing!;
    expect(listing.listing.local_date).toBe("2026-11-04");
    expect(listing.listing.doors_time).toBe("23:00");
  });

  it("does not adjust when start after 12:00", () => {
    const data = {
      event_display_name: "Evening Start",
      slug: "evening-start",
      starttime_ldjson: "2026-11-04T21:00:00",
      endtime_ldjson: "2026-11-05T02:00:00",
      venue_name: "Test",
      venue_address: "",
      venue_latitude: "19",
      venue_longitude: "72",
      min_price: 0,
      max_price: 0,
      status: 1,
      share_url: "https://www.skillboxes.com/events/evening-start",
    };
    const result = skillboxDetailToListing(data, options);
    expect(result.listing).toBeDefined();
    expect(result.startMoved).toBe(false);
    const listing = result.listing!;
    expect(listing.listing.doors_time).toBe("21:00");
  });

  it("adjusts when end is exactly 06:00 next day", () => {
    const data = {
      event_display_name: "End at 6am",
      slug: "end-at-6am",
      starttime_ldjson: "2026-11-04T09:00:00",
      endtime_ldjson: "2026-11-05T06:00:00",
      venue_name: "Test",
      venue_address: "",
      venue_latitude: "19",
      venue_longitude: "72",
      min_price: 0,
      max_price: 0,
      status: 1,
      share_url: "https://www.skillboxes.com/events/end-at-6am",
    };
    const result = skillboxDetailToListing(data, options);
    expect(result.listing).toBeDefined();
    expect(result.startMoved).toBe(true);
    const listing = result.listing!;
    expect(listing.listing.doors_time).toBe("21:00");
    expect(listing.listing.local_date).toBe("2026-11-04");
  });
});

describe("skillboxAdapter harvest", () => {
  it("throws for unknown metro slug", async () => {
    const ctx: RunCtx = {
      metro: { ...MUMBAI, slug: "nyc" },
      now: () => NOW,
      env: {},
      log: () => {},
      http: createPoliteHttp({
        userAgent: "test",
        now: () => NOW.getTime(),
        sleep: async () => {},
        transport: async () => ({ url: "", status: 200, headers: {}, body: "" }),
      }),
    };
    await expect(skillboxAdapter.harvest!(SOURCE, ctx)).rejects.toThrow(
      "SkillBox has no city id for nyc",
    );
  });

  it("adds note when start times are moved due to AM/PM confusion", async () => {
    const seenUrls: string[] = [];
    let t = NOW.getTime();
    const ctx: RunCtx = {
      metro: MUMBAI,
      now: () => new Date(t),
      env: {},
      log: () => {},
      http: createPoliteHttp({
        userAgent: "test",
        now: () => t,
        sleep: async (ms) => {
          t += ms;
        },
        transport: async (req) => {
          seenUrls.push(req.url);
          if (req.url === "https://www.skillboxes.com/robots.txt") {
            return {
              url: req.url,
              status: 200,
              headers: {},
              body: "User-agent: *\nDisallow: /admin/\n",
            };
          }
          if (req.url === SKILLBOX_LIST_URL && req.method === "POST") {
            return {
              url: req.url,
              status: 200,
              headers: {},
              body: JSON.stringify({
                success: true,
                next: false,
                items: [
                  {
                    EventId: 1,
                    slug: "am-pm-party",
                    category: "Club Gigs - Music",
                    subcategories: [{ name: "Techno" }],
                  },
                ],
              }),
            };
          }
          if (req.url === SKILLBOX_DETAILS_URL && req.method === "POST") {
            const { slug } = JSON.parse(req.body as string);
            if (slug === "am-pm-party") {
              return {
                url: req.url,
                status: 200,
                headers: {},
                body: JSON.stringify({
                  success: true,
                  data: {
                    event_display_name: "AM/PM Party",
                    slug: "am-pm-party",
                    starttime_ldjson: "2026-11-04T08:30:00",
                    endtime_ldjson: "2026-11-05T01:30:00",
                    venue_name: "Club",
                    venue_address: "Address",
                    venue_latitude: "19.123456",
                    venue_longitude: "72.123456",
                    min_price: 500,
                    max_price: 1000,
                    status: 1,
                    share_url: "https://www.skillboxes.com/events/am-pm-party",
                  },
                }),
              };
            }
          }
          throw new Error(`Unexpected request: ${req.url}`);
        },
      }),
    };
    const result = await skillboxAdapter.harvest!(SOURCE, ctx);
    // Check that the listing has adjusted doors_time
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.listing.doors_time).toBe("20:30");
    // Check for the AM/PM adjustment note
    expect(result.notes).toContain("SkillBox: 1 start time(s) moved 12h, organiser AM/PM");
  });

  it("pages through list and fetches details", async () => {
    const seenUrls: string[] = [];
    const seenBodies: string[] = [];
    let t = NOW.getTime();
    const ctx: RunCtx = {
      metro: MUMBAI,
      now: () => new Date(t),
      env: {},
      log: () => {},
      http: createPoliteHttp({
        userAgent: "test",
        now: () => t,
        sleep: async (ms) => {
          t += ms;
        },
        transport: async (req: TransportRequest) => {
          seenUrls.push(req.url);
          if (req.url === "https://www.skillboxes.com/robots.txt") {
            return {
              url: req.url,
              status: 200,
              headers: {},
              body: "User-agent: *\nDisallow: /admin/\n",
            };
          }
          if (req.url === SKILLBOX_LIST_URL && req.method === "POST") {
            const body = req.body as string;
            seenBodies.push(body);
            const parsed = JSON.parse(body);
            if (parsed.page === 1) {
              return {
                url: req.url,
                status: 200,
                headers: {},
                body: JSON.stringify({
                  success: true,
                  next: true,
                  items: [
                    {
                      EventId: 1,
                      slug: "techno-night",
                      category: "Club Gigs - Music",
                      subcategories: [{ name: "Techno" }],
                    },
                    {
                      EventId: 2,
                      slug: "metal-night",
                      category: "Club Gigs - Music",
                      subcategories: [{ name: "Progressive Metal" }],
                    },
                    {
                      EventId: 1,
                      slug: "techno-night",
                      category: "Club Gigs - Music",
                      subcategories: [{ name: "Techno" }],
                    }, // duplicate
                  ],
                }),
              };
            } else if (parsed.page === 2) {
              return {
                url: req.url,
                status: 200,
                headers: {},
                body: JSON.stringify({
                  success: true,
                  next: false,
                  items: [
                    {
                      EventId: 3,
                      slug: "diwali-party",
                      category: "Diwali 2026",
                      subcategories: [{ name: "Diwali Party" }],
                    },
                  ],
                }),
              };
            }
          }
          if (req.url === SKILLBOX_DETAILS_URL && req.method === "POST") {
            const body = req.body as string;
            const { slug } = JSON.parse(body);
            if (slug === "techno-night") {
              return {
                url: req.url,
                status: 200,
                headers: {},
                body: JSON.stringify({
                  success: true,
                  data: {
                    event_display_name: "Techno Night",
                    slug: "techno-night",
                    starttime_ldjson: "2026-11-01T22:00:00",
                    endtime_ldjson: "2026-11-02T02:00:00",
                    venue_name: "Club",
                    venue_address: "Address",
                    venue_latitude: "19.123456",
                    venue_longitude: "72.123456",
                    min_price: 500,
                    max_price: 1000,
                    status: 1,
                    share_url: "https://www.skillboxes.com/events/techno-night",
                  },
                }),
              };
            }
            if (slug === "diwali-party") {
              return {
                url: req.url,
                status: 200,
                headers: {},
                body: JSON.stringify({
                  success: true,
                  data: {
                    event_display_name: "Diwali Party",
                    slug: "diwali-party",
                    starttime_ldjson: "2026-11-01T20:00:00",
                    endtime_ldjson: "2026-11-01T23:00:00",
                    venue_name: "Venue",
                    venue_address: "Address",
                    venue_latitude: "19.123456",
                    venue_longitude: "72.123456",
                    min_price: 0,
                    max_price: 0,
                    status: 1,
                    share_url: "https://www.skillboxes.com/events/diwali-party",
                  },
                }),
              };
            }
          }
          throw new Error(`Unexpected request: ${req.url}`);
        },
      }),
    };
    const result = await skillboxAdapter.harvest!(SOURCE, ctx);
    // Check list requests
    expect(seenBodies[0]).toBe('{"opcode":"search","type":"upcoming","page":1,"city":5}');
    expect(seenBodies[1]).toBe('{"opcode":"search","type":"upcoming","page":2,"city":5}');
    // Should have 2 detail requests (techno-night and diwali-party)
    expect(seenUrls.filter((u) => u === SKILLBOX_DETAILS_URL).length).toBe(2);
    // Should have 2 listings
    expect(result.listings).toHaveLength(2);
    expect(result.notes?.[0]).toMatch(/3 list item\(s\), 2 dance night\(s\), 2 detail\(s\) read/);
    // Check for the AM/PM adjustment note
    const adjustmentNote = result.notes?.find((n) => n.includes("start time(s) moved 12h"));
    // In this test, none of the mocked events have AM/PM confusion, so adjustmentNote should be undefined
    expect(adjustmentNote).toBeUndefined();
  });
});

describe("constants", () => {
  it("exports constants", () => {
    expect(SKILLBOX_LIST_URL).toBe(
      "https://www.skillboxes.com/servers/v3/api/event-new/get-event-new",
    );
    expect(SKILLBOX_DETAILS_URL).toBe(
      "https://www.skillboxes.com/servers/v3/api/event-new/event-details",
    );
    expect(SKILLBOX_CITIES.mumbai).toEqual([5]);
    expect(SKILLBOX_CITIES.delhi).toEqual([2, 3]);
    expect(MAX_SKILLBOX_LIST_PAGES).toBe(12);
    expect(MAX_SKILLBOX_DETAILS).toBe(30);
  });
});
