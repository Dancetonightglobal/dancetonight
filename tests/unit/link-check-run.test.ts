import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createPoliteHttp,
  type TransportRequest,
  type TransportResponse,
} from "@/src/pipeline/http";
import { cardLinkUrls, runLinkChecks } from "@/src/pipeline/link-check-run";
import { linkChecks } from "@/src/db/schema/ops";
import type { Listing } from "@/src/domain/listing";
import { requireDbInCi, describeDb, testDb, resetDb, closeTestDb } from "@/tests/unit/db-harness";

requireDbInCi();

describeDb("link-check-run", () => {
  let db: Awaited<ReturnType<typeof testDb>>;

  beforeAll(async () => {
    db = await testDb("link_check_run");
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  describe("cardLinkUrls", () => {
    it("returns unique URLs without fragments, preserving order", () => {
      const listings: Listing[] = [
        {
          id: "1",
          slug: "test-1",
          title: "Salsa Night",
          ticketUrl: null,
          sources: [
            {
              url: "https://example.com/event#tickets",
              byOrganiser: false,
              tier: "listing",
              eventUrl: null,
            },
          ],
          confirmation: null,
          liveStatus: null,
          startsAt: new Date(),
          canonicalUrl: null,
        } as unknown as Listing,
        {
          id: "2",
          slug: "test-2",
          title: "Bachata Night",
          ticketUrl: null,
          sources: [
            {
              url: "https://example.com/event",
              byOrganiser: false,
              tier: "listing",
              eventUrl: null,
            },
          ],
          confirmation: null,
          liveStatus: null,
          startsAt: new Date(),
          canonicalUrl: null,
        } as unknown as Listing,
        {
          id: "3",
          slug: "test-3",
          title: "Kizomba Night",
          ticketUrl: null,
          sources: [
            {
              url: "https://listings.com/event#details",
              byOrganiser: false,
              tier: "listing",
              eventUrl: null,
            },
          ],
          confirmation: null,
          liveStatus: null,
          startsAt: new Date(),
          canonicalUrl: null,
        } as unknown as Listing,
      ];
      const urls = cardLinkUrls(listings);
      expect(urls).toEqual(["https://example.com/event", "https://listings.com/event"]);
    });

    it("skips non-http URLs", () => {
      const listings: Listing[] = [
        {
          id: "1",
          slug: "test",
          title: "Test",
          ticketUrl: "ftp://example.com/event",
          sources: [],
        } as unknown as Listing,
      ];
      const urls = cardLinkUrls(listings);
      expect(urls).toEqual([]);
    });
  });

  describe("runLinkChecks", () => {
    it("writes broken row for 404", async () => {
      const transport = async () => ({
        url: "https://example.com/page",
        status: 404,
        headers: {},
        body: "",
      });
      const http = createPoliteHttp({
        transport,
        userAgent: "test",
        sleep: async () => {},
      });
      const stats = await runLinkChecks({
        db,
        http,
        urls: ["https://example.com/page"],
        deadline: Date.now() + 10_000,
      });
      expect(stats.checked).toBe(1);
      expect(stats.broken).toBe(1);
      const rows = await db.select().from(linkChecks);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.broken).toBe(true);
      expect(rows[0]!.failures).toBe(1);
      expect(rows[0]!.reason).toBe("http 404");
    });

    it("writes ok row for 200", async () => {
      const transport = async () => ({
        url: "https://example.com/ok",
        status: 200,
        headers: {},
        body: "",
      });
      const http = createPoliteHttp({
        transport,
        userAgent: "test",
        sleep: async () => {},
      });
      const stats = await runLinkChecks({
        db,
        http,
        urls: ["https://example.com/ok"],
        deadline: Date.now() + 10_000,
      });
      expect(stats.checked).toBe(1);
      expect(stats.broken).toBe(0);
      const rows = await db.select().from(linkChecks);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.broken).toBe(false);
      expect(rows[0]!.failures).toBe(0);
      expect(rows[0]!.reason).toBeNull();
    });

    it("handles unknown verdict (500) without writing row", async () => {
      const transport = async () => ({
        url: "https://example.com/error",
        status: 500,
        headers: {},
        body: "",
      });
      const http = createPoliteHttp({
        transport,
        userAgent: "test",
        sleep: async () => {},
      });
      const stats = await runLinkChecks({
        db,
        http,
        urls: ["https://example.com/error"],
        deadline: Date.now() + 10_000,
      });
      expect(stats.checked).toBe(0);
      expect(stats.unknown).toBe(1);
      const rows = await db.select().from(linkChecks);
      expect(rows).toHaveLength(0);
    });

    it("skips all URLs when deadline passed", async () => {
      const transport = async () => ({
        url: "https://example.com/page",
        status: 200,
        headers: {},
        body: "",
      });
      const http = createPoliteHttp({
        transport,
        userAgent: "test",
        sleep: async () => {},
      });
      const stats = await runLinkChecks({
        db,
        http,
        urls: ["https://example.com/page", "https://example.com/other"],
        deadline: Date.now() - 1,
      });
      expect(stats.checked).toBe(0);
      expect(stats.skipped).toBe(2);
      const rows = await db.select().from(linkChecks);
      expect(rows).toHaveLength(0);
    });

    it("checks new URL before existing when ordering", async () => {
      // Insert an existing row checked yesterday
      const yesterday = new Date(Date.now() - 86_400_000);
      await db.insert(linkChecks).values({
        url: "https://example.com/old",
        checkedAt: yesterday,
        broken: false,
        failures: 0,
        reason: null,
      });

      const callOrder: string[] = [];
      const transport = async (req: TransportRequest): Promise<TransportResponse> => {
        // Determine which URL is being requested
        const url = req.url;
        // Skip robots.txt from the order check
        if (!url.endsWith("/robots.txt")) {
          callOrder.push(url);
        }
        return {
          url,
          status: 200,
          headers: {},
          body: "",
        };
      };
      const http = createPoliteHttp({
        transport,
        userAgent: "test",
        sleep: async () => {},
      });

      const stats = await runLinkChecks({
        db,
        http,
        urls: ["https://example.com/new", "https://example.com/old"],
        deadline: Date.now() + 10_000,
      });
      // Both URLs should be checked because there is time
      expect(stats.checked).toBe(2);
      expect(stats.skipped).toBe(0);
      // New URL should be checked before old URL (no row first)
      expect(callOrder).toEqual(["https://example.com/new", "https://example.com/old"]);
    });

    it("network error once -> broken false, twice -> broken true", async () => {
      let attempt = 0;
      const { HttpError } = await import("@/src/pipeline/http");
      const transport = async (req: TransportRequest): Promise<TransportResponse> => {
        // Handle robots.txt
        if (req.url.endsWith("/robots.txt")) {
          return {
            url: req.url,
            status: 404,
            headers: {},
            body: "",
          };
        }
        attempt++;
        if (attempt === 1) {
          throw new HttpError("network", "https://example.com/unreachable", "ENOTFOUND");
        }
        return {
          url: "https://example.com/unreachable",
          status: 200,
          headers: {},
          body: "",
        };
      };
      const http = createPoliteHttp({
        transport,
        userAgent: "test",
        sleep: async () => {},
      });

      // First run
      const stats1 = await runLinkChecks({
        db,
        http,
        urls: ["https://example.com/unreachable"],
        deadline: Date.now() + 10_000,
      });
      expect(stats1.checked).toBe(1);
      expect(stats1.broken).toBe(0);
      const rows1 = await db.select().from(linkChecks);
      expect(rows1[0]!.failures).toBe(1);
      expect(rows1[0]!.broken).toBe(false);

      // Reset attempt counter for second run
      attempt = 0;
      const stats2 = await runLinkChecks({
        db,
        http,
        urls: ["https://example.com/unreachable"],
        deadline: Date.now() + 10_000,
      });
      expect(stats2.checked).toBe(1);
      expect(stats2.broken).toBe(1);
      const rows2 = await db.select().from(linkChecks);
      expect(rows2[0]!.failures).toBe(2);
      expect(rows2[0]!.broken).toBe(true);
    });
  });
});
