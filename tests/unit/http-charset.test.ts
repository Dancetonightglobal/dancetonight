import { describe, expect, it } from "vitest";
import { decodeBody } from "@/src/pipeline/http";

describe("decodeBody", () => {
  // Helper to create Uint8Array from array of numbers
  const bytes = (arr: number[]) => new Uint8Array(arr);

  it("decodes Shift_JIS from Content-Type header", () => {
    // "東京" in Shift_JIS: 0x93,0x8c,0x8b,0x9e
    const bodyBytes = [
      ...bytes([0x3c, 0x70, 0x3e]),
      0x93,
      0x8c,
      0x8b,
      0x9e,
      0x3c,
      0x2f,
      0x70,
      0x3e,
    ];
    const result = decodeBody(bytes(bodyBytes), "text/html; charset=Shift_JIS");
    expect(result).toBe("<p>東京</p>");
  });

  it("decodes windows-31j alias", () => {
    const bodyBytes = [
      ...bytes([0x3c, 0x70, 0x3e]),
      0x93,
      0x8c,
      0x8b,
      0x9e,
      0x3c,
      0x2f,
      0x70,
      0x3e,
    ];
    const result = decodeBody(bytes(bodyBytes), 'text/html; charset="windows-31j"');
    expect(result).toBe("<p>東京</p>");
  });

  it("extracts charset from meta http-equiv when no header charset", () => {
    // "サルサ" in Shift_JIS: 0x83,0x54,0x83,0x8b,0x83,0x54
    const meta = '<META HTTP-EQUIV="Content-Type" CONTENT="text/html;charset=Shift_JIS">';
    const metaBytes = Array.from(meta, (c) => c.charCodeAt(0));
    const contentBytes = [0x83, 0x54, 0x83, 0x8b, 0x83, 0x54];
    const allBytes = [...metaBytes, ...contentBytes];
    const result = decodeBody(bytes(allBytes), "text/html");
    expect(result).toContain("サルサ");
  });

  it("extracts charset from meta charset attribute", () => {
    const meta = '<meta charset="utf-8">';
    const metaBytes = Array.from(meta, (c) => c.charCodeAt(0));
    // "日本" in UTF-8: 0xe6,0x97,0xa5,0xe6,0x9c,0xac
    const utf8Bytes = [0xe6, 0x97, 0xa5, 0xe6, 0x9c, 0xac];
    const allBytes = [...metaBytes, ...utf8Bytes];
    const result = decodeBody(bytes(allBytes), null);
    expect(result).toContain("日本");
  });

  it("falls back to UTF-8 when no charset declared", () => {
    const utf8Bytes = [0xe6, 0x97, 0xa5, 0xe6, 0x9c, 0xac]; // "日本"
    const result = decodeBody(bytes(utf8Bytes), null);
    expect(result).toBe("日本");
  });

  it("ignores unknown charset label and falls back to UTF-8", () => {
    const utf8Bytes = [0xe6, 0x97, 0xa5, 0xe6, 0x9c, 0xac];
    const result = decodeBody(bytes(utf8Bytes), "text/html; charset=nonsense-xyz");
    expect(result).toBe("日本");
  });

  it("UTF-8 BOM overrides header charset", () => {
    // BOM + "日本" in UTF-8
    const bom = [0xef, 0xbb, 0xbf];
    const utf8Bytes = [0xe6, 0x97, 0xa5, 0xe6, 0x9c, 0xac];
    const allBytes = [...bom, ...utf8Bytes];
    const result = decodeBody(bytes(allBytes), "text/html; charset=Shift_JIS");
    expect(result).toBe("日本");
  });

  it("ignores a meta tag after the first 4,096 bytes", () => {
    const padding = Array.from("<!-- " + "x".repeat(4100) + " -->", (c) => c.charCodeAt(0));
    const meta = Array.from('<meta charset="Shift_JIS">', (c) => c.charCodeAt(0));
    const result = decodeBody(bytes([...padding, ...meta, 0x93, 0x8c, 0x8b, 0x9e]), null);
    expect(result).not.toContain("東京");
  });

  it("decodes UTF-8 pages exactly as before (no charset, BOM, utf-8 label)", () => {
    const before = (b: Uint8Array) => new TextDecoder("utf-8").decode(b);
    const plain = new TextEncoder().encode("<p>café 日本</p>");
    const withBom = bytes([0xef, 0xbb, 0xbf, ...plain]);
    expect(decodeBody(plain, null)).toBe(before(plain));
    expect(decodeBody(withBom, null)).toBe(before(withBom));
    expect(decodeBody(plain, "text/html; charset=utf-8")).toBe(before(plain));
  });

  it("keeps valid UTF-8 as UTF-8 even when the page mislabels it", () => {
    const plain = new TextEncoder().encode("<p>café 日本</p>");
    expect(decodeBody(plain, "text/html; charset=iso-8859-1")).toBe("<p>café 日本</p>");
    expect(decodeBody(plain, "text/html; charset=Shift_JIS")).toBe("<p>café 日本</p>");
  });
  it("keeps a mislabelled UTF-8 page as UTF-8 when its last character is cut off", () => {
    const plain = new TextEncoder().encode("<p>café 日本</p>日");
    const cut = plain.subarray(0, plain.length - 1);
    const result = decodeBody(cut, "text/html; charset=iso-8859-1");
    expect(result.startsWith("<p>café 日本</p>")).toBe(true);
  });
});
