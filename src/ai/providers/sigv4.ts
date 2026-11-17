/**
 * AWS Signature Version 4 request signer.
 *
 * This is a small, dependency-free implementation for signing requests to AWS
 * services (specifically Bedrock). We avoid the full AWS SDK because it's not
 * worth the dependency overhead for a single signed POST request.
 */

import { createHash, createHmac } from "node:crypto";

export interface SigV4Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string | undefined;
}

export interface SigV4Input {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly region: string;
  readonly service: string;
  readonly credentials: SigV4Credentials;
  readonly now: Date;
}

/** sha256 hex of a UTF-8 string. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf-8").digest();
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
}

function rfc3986Encode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function normalizeHeaderValue(value: string): string {
  // Trim and collapse internal whitespace to single space
  return value.trim().replace(/\s+/g, " ");
}

export function signRequest(input: SigV4Input): Record<string, string> {
  const amzDate = toAmzDate(input.now);
  const dateStamp = amzDate.slice(0, 8);

  // Parse URL
  const url = new URL(input.url);

  // Build canonical URI
  const pathname = url.pathname || "/";
  const canonicalUri =
    pathname === "/"
      ? "/"
      : pathname
          .split("/")
          .map((segment) => (segment === "" ? "" : rfc3986Encode(segment)))
          .join("/");

  // Build canonical query string
  const searchParams: Array<[string, string]> = [];
  url.searchParams.forEach((value, key) => {
    searchParams.push([key, value]);
  });
  // Code-point order, as SigV4 requires; localeCompare would follow the runtime's locale.
  const byCodePoint = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
  searchParams.sort((a, b) => byCodePoint(a[0], b[0]) || byCodePoint(a[1], b[1]));
  const canonicalQuery = searchParams
    .map(([k, v]) => `${rfc3986Encode(k)}=${rfc3986Encode(v)}`)
    .join("&");

  // Build headers to sign
  const headersToSign: Record<string, string> = {};

  // Add lower-cased caller headers
  for (const [name, value] of Object.entries(input.headers)) {
    const lowerName = name.toLowerCase();
    if (lowerName !== "host") {
      headersToSign[lowerName] = normalizeHeaderValue(value);
    }
  }

  // Add host header
  const host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
  headersToSign["host"] = host;

  // Add x-amz-date
  headersToSign["x-amz-date"] = amzDate;

  // Add x-amz-security-token if session token exists
  if (input.credentials.sessionToken && input.credentials.sessionToken.length > 0) {
    headersToSign["x-amz-security-token"] = input.credentials.sessionToken;
  }

  // Build canonical headers and signed headers
  const sortedHeaderNames = Object.keys(headersToSign).sort();
  const canonicalHeaders = sortedHeaderNames
    .map((name) => `${name}:${headersToSign[name]}\n`)
    .join("");
  const signedHeaders = sortedHeaderNames.join(";");

  // Payload hash
  const payloadHash = sha256Hex(input.body);

  // Canonical request
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  // String to sign
  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  // Signing key
  const kDate = hmacSha256("AWS4" + input.credentials.secretAccessKey, dateStamp);
  const kRegion = hmacSha256(kDate, input.region);
  const kService = hmacSha256(kRegion, input.service);
  const kSigning = hmacSha256(kService, "aws4_request");

  // Signature
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf-8").digest("hex");

  // Authorization header
  const authorization = `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  // Build result: lower-cased caller headers + new headers, no host
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    const lowerName = name.toLowerCase();
    if (lowerName !== "host") {
      result[lowerName] = value;
    }
  }
  result["x-amz-date"] = amzDate;
  if (input.credentials.sessionToken && input.credentials.sessionToken.length > 0) {
    result["x-amz-security-token"] = input.credentials.sessionToken;
  }
  result["authorization"] = authorization;

  return result;
}
