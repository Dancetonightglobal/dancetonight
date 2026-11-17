// A visitor's URL never reaches our own network (D-134).
import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPoliteHttp, HttpError } from "@/src/pipeline/http";
import {
  guardedLookup,
  isPublicAddress,
  untrustedTransport,
  untrustedUrlProblem,
} from "@/src/pipeline/untrusted-transport";

describe("which addresses are public", () => {
  it("refuses loopback, private, link-local, metadata, reserved and their IPv6 forms", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "::ffff:127.0.0.1",
      "::ffff:169.254.169.254",
      "64:ff9b::10.0.0.1",
      "2002:7f00:0001::1",
      "2001:db8::1",
      "2001::1",
      "fec0::1",
      "ff02::1",
      "::ffff:0:10.0.0.1",
      "64:ff9b::7f00:1",
      "192.88.99.1",
      "not an address",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("allows public addresses", () => {
    for (const address of [
      "93.184.216.34",
      "172.32.0.1",
      "8.8.8.8",
      "2606:4700::1111",
      "::ffff:8.8.8.8",
      "2002:0808:0808::1",
      "2a00:1450:4001::200e",
    ]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });
});

describe("which URLs a visitor may give", () => {
  it("names what is wrong with each refused URL", () => {
    expect(untrustedUrlProblem("https://salsa.example/events")).toBeNull();
    expect(untrustedUrlProblem("http://salsa.example:80/")).toBeNull();
    expect(untrustedUrlProblem("ftp://salsa.example/")).toBe("only http and https");
    expect(untrustedUrlProblem("file:///etc/passwd")).toBe("only http and https");
    expect(untrustedUrlProblem("https://user:pw@salsa.example/")).toBe(
      "a user name or password in the URL",
    );
    expect(untrustedUrlProblem("http://salsa.example:8080/")).toBe("port 8080");
    expect(untrustedUrlProblem("http://169.254.169.254/latest/meta-data/")).toBe(
      "a private or local address",
    );
    expect(untrustedUrlProblem("http://[::1]/")).toBe("a private or local address");
    expect(untrustedUrlProblem("http://localhost/")).toBe("a local name");
    expect(untrustedUrlProblem("http://printer.local/")).toBe("a local name");
    expect(untrustedUrlProblem("http://metadata/")).toBe("a local name");
    expect(untrustedUrlProblem("not a url")).toBe("not a URL");
  });
});

describe("the guarded lookup", () => {
  const resolver =
    (answers: Record<string, string[]>) =>
    (
      host: string,
      _o: { all: true },
      cb: (e: NodeJS.ErrnoException | null, a: { address: string; family: number }[]) => void,
    ) =>
      cb(
        null,
        (answers[host] ?? []).map((address) => ({
          address,
          family: address.includes(":") ? 6 : 4,
        })),
      );

  it("refuses a name when any of its addresses is private", async () => {
    const lookup = guardedLookup(
      resolver({
        "rebind.example": ["93.184.216.34", "10.0.0.5"],
        "ok.example": ["93.184.216.34"],
      }),
    );
    const ask = (host: string) =>
      new Promise<string>((resolve, reject) =>
        lookup(host, {}, (error, address) => (error ? reject(error) : resolve(String(address)))),
      );
    await expect(ask("rebind.example")).rejects.toThrow(
      /rebind\.example resolves to an address that may not be fetched/,
    );
    await expect(ask("nothing.example")).rejects.toThrow(/may not be fetched/);
    await expect(ask("ok.example")).resolves.toBe("93.184.216.34");
  });
});

describe("the transport, against a local server", () => {
  let server: http.Server;
  let other: http.Server;
  let port = 0;
  let otherPort = 0;
  const hits: string[] = [];
  const otherHeaders: http.IncomingHttpHeaders[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url ?? "");
      if (req.url === "/robots.txt") return res.end("User-agent: *\nAllow: /\n");
      if (req.url === "/hop") {
        res.writeHead(302, { location: `http://127.0.0.1:${port}/event` });
        return res.end();
      }
      if (req.url === "/to-file") {
        res.writeHead(302, { location: "file:///etc/passwd" });
        return res.end();
      }
      if (req.url === "/to-credentials") {
        res.writeHead(302, { location: `http://user:pw@127.0.0.1:${port}/event` });
        return res.end();
      }
      if (req.url === "/to-other-host") {
        res.writeHead(302, { location: `http://127.0.0.2:${otherPort}/event` });
        return res.end();
      }
      if (req.url === "/endless-redirect") {
        // A redirect whose body never ends: the transport must not wait for it.
        res.writeHead(302, { location: `http://127.0.0.1:${port}/event` });
        res.write("x");
        return;
      }
      if (req.url === "/to-metadata") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
        return res.end();
      }
      if (req.url === "/to-private-name") {
        res.writeHead(301, { location: "http://intranet.example/" });
        return res.end();
      }
      if (req.url === "/loop") {
        res.writeHead(302, { location: "/loop" });
        return res.end();
      }
      if (req.url === "/big") return res.end("x".repeat(2_000));
      res.setHeader("content-type", "text/html");
      res.end("<h1>Friday salsa social</h1>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
    other = http.createServer((req, res) => {
      otherHeaders.push(req.headers);
      res.end("other host");
    });
    await new Promise<void>((resolve) => other.listen(0, "127.0.0.2", resolve));
    otherPort = (other.address() as AddressInfo).port;
  });
  afterAll(async () => {
    for (const s of [server, other]) {
      s.closeAllConnections();
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  // The local servers are on 127.0.0.1 and 127.0.0.2, which a real run refuses; the tests allow
  // those two addresses and their ports (and only them) to exercise redirects.
  const testTransport = () =>
    untrustedTransport({
      policy: {
        allowed: (address) => address === "127.0.0.1" || address === "127.0.0.2",
        ports: ["", "80", "443", String(port), String(otherPort)],
      },
      resolve: (host, _o, cb) =>
        host === "intranet.example"
          ? cb(null, [{ address: "10.0.0.7", family: 4 }])
          : cb(null, [{ address: "127.0.0.1", family: 4 }]),
    });
  const request = (
    transport: ReturnType<typeof untrustedTransport>,
    path: string,
    maxBytes = 1e6,
  ) =>
    transport({
      url: `http://127.0.0.1:${port}${path}`,
      method: "GET",
      headers: {},
      signal: new AbortController().signal,
      maxBytes,
    });

  it("refuses local addresses, however they are spelled, with the default rules", async () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://2130706433/",
      "http://0x7f.1/",
      "http://[::1]/",
      "http://[::ffff:169.254.169.254]/",
      "http://169.254.169.254/latest/meta-data/",
    ]) {
      await expect(
        untrustedTransport()({
          url,
          method: "GET",
          headers: {},
          signal: new AbortController().signal,
          maxBytes: 1e6,
        }),
        url,
      ).rejects.toThrow(/may not be fetched: a private or local address/);
    }
  });

  it("refuses a redirect to file: or to a URL with credentials", async () => {
    await expect(request(testTransport(), "/to-file")).rejects.toThrow(/only http and https/);
    await expect(request(testTransport(), "/to-credentials")).rejects.toThrow(
      /a user name or password/,
    );
  });

  it("sends another host none of this one's credentials or validators", async () => {
    const answer = await testTransport()({
      url: `http://127.0.0.1:${port}/to-other-host`,
      method: "GET",
      headers: {
        authorization: "Bearer secret",
        cookie: "a=b",
        "if-none-match": '"v1"',
        "user-agent": "DanceTonightBot/1.0",
      },
      signal: new AbortController().signal,
      maxBytes: 1e6,
    });
    expect(answer.body).toBe("other host");
    const sent = otherHeaders.at(-1)!;
    expect(sent.authorization).toBeUndefined();
    expect(sent.cookie).toBeUndefined();
    expect(sent["if-none-match"]).toBeUndefined();
    expect(sent["user-agent"]).toBe("DanceTonightBot/1.0");
  });

  it("does not wait on a redirect's body, and closes its socket", async () => {
    await expect(request(testTransport(), "/endless-redirect")).resolves.toMatchObject({
      status: 200,
      body: "<h1>Friday salsa social</h1>",
    });
    const open = () =>
      new Promise<number>((resolve) => server.getConnections((_e, n) => resolve(n)));
    for (let i = 0; i < 50 && (await open()) > 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(await open()).toBe(0);
  });

  it("follows a redirect it has checked, and refuses one to the metadata address", async () => {
    const transport = testTransport();
    await expect(request(transport, "/hop")).resolves.toMatchObject({
      status: 200,
      url: `http://127.0.0.1:${port}/event`,
      body: "<h1>Friday salsa social</h1>",
    });
    const error = await request(transport, "/to-metadata").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).message).toMatch(/169\.254\.169\.254|a private or local address/);
    expect(hits).not.toContain("/latest/meta-data/");
  });

  it("refuses a redirect to a name that resolves to a private address, at connect time", async () => {
    await expect(request(testTransport(), "/to-private-name")).rejects.toThrow(
      /may not be fetched/,
    );
  });

  it("stops after five redirects, and at the size cap", async () => {
    await expect(request(testTransport(), "/loop")).rejects.toThrow(/more than 5 redirects/);
    await expect(request(testTransport(), "/big", 1_000)).rejects.toThrow(/over the cap/);
  });

  it("serves a polite client, robots.txt included", async () => {
    const client = createPoliteHttp({
      transport: testTransport(),
      userAgent: "DanceTonightBot/1.0",
      sleep: async () => {},
    });
    const page = await client.request({ url: `http://127.0.0.1:${port}/event`, purpose: "crawl" });
    expect(page.body).toContain("Friday salsa social");
    expect(hits).toContain("/robots.txt");
  });
});
