// Maintenance M1: the archive job writes past nights to one Google spreadsheet the owner shares with a service account
// (a tab per month). A tiny REST client, no SDK: a service-account JWT (RS256, node:crypto) for an access token, then
// Sheets v4 calls. Values are written RAW so a stranger's title like "=IMPORTXML(...)" stays text, never a formula.

import { createSign } from "node:crypto";

const TOKEN_REUSE_MS = 50 * 60 * 1000;

export async function serviceAccountToken(
  saJson: string,
  now: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  let sa: { client_email?: string; private_key?: string };
  try {
    sa = JSON.parse(saJson);
  } catch {
    throw new Error("GOOGLE_SA_JSON is not a service account key");
  }
  if (
    typeof sa !== "object" ||
    sa === null ||
    typeof sa.client_email !== "string" ||
    typeof sa.private_key !== "string"
  ) {
    throw new Error("GOOGLE_SA_JSON is not a service account key");
  }

  const iat = Math.floor(now.getTime() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp: iat + 3600,
  };

  const h = Buffer.from(JSON.stringify(header)).toString("base64url");
  const c = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${h}.${c}`);
  const signature = signer.sign(sa.private_key).toString("base64url");
  const jwt = `${h}.${c}.${signature}`;

  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`Google token request failed: ${response.status}`);
  }

  const json = (await response.json()) as { access_token?: unknown };
  if (typeof json.access_token !== "string") {
    throw new Error("Google token request failed: invalid response");
  }
  return json.access_token;
}

export interface SheetsClient {
  tabs(): Promise<string[]>;
  addTab(title: string): Promise<void>;
  readColumn(tab: string, column: string): Promise<string[]>;
  append(tab: string, rows: string[][]): Promise<void>;
}

export function googleSheetsClient(options: {
  saJson: string;
  spreadsheetId: string;
  fetch?: typeof fetch;
  now?: () => Date;
}): SheetsClient {
  const { saJson, spreadsheetId } = options;
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());

  // A token lives an hour; it is reused for 50 minutes, and a failed request is never reused.
  let tokenPromise: Promise<string> | null = null;
  let issuedAt = 0;

  const getToken = async (): Promise<string> => {
    const currentTime = now().getTime();
    if (tokenPromise && currentTime - issuedAt < TOKEN_REUSE_MS) return tokenPromise;
    issuedAt = currentTime;
    const pending = serviceAccountToken(saJson, now(), fetchImpl);
    tokenPromise = pending;
    pending.catch(() => {
      if (tokenPromise === pending) tokenPromise = null;
    });
    return pending;
  };

  const apiCall = async (
    path: string,
    init?: RequestInit & { what?: string },
  ): Promise<Response> => {
    const { what = "request", method = "GET", body } = init ?? {};
    const token = await getToken();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}${path}`;
    const response = await fetchImpl(url, {
      method,
      ...(body === undefined ? {} : { body }),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Sheets ${what} failed: ${response.status} ${text.slice(0, 200)}`);
    }
    return response;
  };

  const quoteTab = (tab: string): string => {
    return `'${tab.replace(/'/g, "''")}'`;
  };

  return {
    async tabs(): Promise<string[]> {
      const response = await apiCall(`?fields=sheets.properties.title`, {
        what: "tabs",
      });
      const json = (await response.json()) as {
        sheets?: Array<{ properties?: { title?: unknown } }>;
      };
      return (json.sheets ?? [])
        .map((s) => s.properties?.title)
        .filter((t): t is string => typeof t === "string");
    },

    async addTab(title: string): Promise<void> {
      await apiCall(`:batchUpdate`, {
        method: "POST",
        what: "addTab",
        body: JSON.stringify({
          requests: [{ addSheet: { properties: { title } } }],
        }),
      });
    },

    async readColumn(tab: string, column: string): Promise<string[]> {
      const range = `${quoteTab(tab)}!${column}:${column}`;
      const response = await apiCall(`/values/${encodeURIComponent(range)}`, {
        what: "readColumn",
      });
      const json = (await response.json()) as { values?: unknown[][] };
      return (json.values ?? []).map((row) => String(row[0] ?? ""));
    },

    async append(tab: string, rows: string[][]): Promise<void> {
      const range = `${quoteTab(tab)}!A1`;
      const query = `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
      await apiCall(`/values/${encodeURIComponent(range)}:append${query}`, {
        method: "POST",
        what: "append",
        body: JSON.stringify({ values: rows }),
      });
    },
  };
}
