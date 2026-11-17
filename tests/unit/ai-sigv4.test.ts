import { describe, expect, it } from "vitest";
import {
  sha256Hex,
  signRequest,
  type SigV4Credentials,
  type SigV4Input,
} from "@/src/ai/providers/sigv4";

const credentials: SigV4Credentials = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};

describe("sha256Hex", () => {
  it("returns correct hash for empty string", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("signRequest", () => {
  it("AWS get-vanilla test vector", () => {
    const input: SigV4Input = {
      method: "GET",
      url: "https://example.amazonaws.com/",
      headers: {},
      body: "",
      region: "us-east-1",
      service: "service",
      credentials,
      now: new Date("2015-08-30T12:36:00Z"),
    };

    const result = signRequest(input);

    expect(result["x-amz-date"]).toBe("20150830T123600Z");
    expect(result["authorization"]).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
  });

  it("Converse POST", () => {
    const body = '{"messages":[{"role":"user","content":[{"text":"hi"}]}]}';
    expect(sha256Hex(body)).toBe(
      "c3335e07d6e89650bf94cb98664be69f8774dbc3198df221f113db0a59ea14f0",
    );

    const input: SigV4Input = {
      method: "POST",
      url: "https://bedrock-runtime.us-east-1.amazonaws.com/model/deepseek.v3.2/converse",
      headers: { "Content-Type": "application/json" },
      body,
      region: "us-east-1",
      service: "bedrock",
      credentials,
      now: new Date("2026-10-12T09:00:00Z"),
    };

    const result = signRequest(input);

    expect(result["content-type"]).toBe("application/json");
    expect(result["host"]).toBeUndefined();
    expect(result["x-amz-date"]).toBe("20261012T090000Z");
    expect(result["authorization"]).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261012/us-east-1/bedrock/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=dc7199e46b9f8c98f42d3c8b4edc2de8abaa0ffa42492ef8f112e5099627cf10",
    );
  });

  it("Converse POST with session token", () => {
    const body = '{"messages":[{"role":"user","content":[{"text":"hi"}]}]}';

    const credsWithToken: SigV4Credentials = {
      ...credentials,
      sessionToken: "TOKEN",
    };

    const input: SigV4Input = {
      method: "POST",
      url: "https://bedrock-runtime.us-east-1.amazonaws.com/model/deepseek.v3.2/converse",
      headers: { "Content-Type": "application/json" },
      body,
      region: "us-east-1",
      service: "bedrock",
      credentials: credsWithToken,
      now: new Date("2026-10-12T09:00:00Z"),
    };

    const result = signRequest(input);

    expect(result["x-amz-security-token"]).toBe("TOKEN");
    expect(result["authorization"]).toContain(
      "SignedHeaders=content-type;host;x-amz-date;x-amz-security-token",
    );
  });

  it("does not mutate input headers", () => {
    const originalHeaders = { "Content-Type": "application/json", "X-Custom": "value" };
    const headersCopy = { ...originalHeaders };

    const input: SigV4Input = {
      method: "POST",
      url: "https://bedrock-runtime.us-east-1.amazonaws.com/model/test/converse",
      headers: originalHeaders,
      body: "{}",
      region: "us-east-1",
      service: "bedrock",
      credentials,
      now: new Date("2026-10-12T09:00:00Z"),
    };

    signRequest(input);

    expect(originalHeaders).toEqual(headersCopy);
  });
});
