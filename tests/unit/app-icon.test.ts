// The app icon (D-069): the live site answered /favicon.ico with a 404 and had no icon at all.
// Next serves app/icon.svg, app/apple-icon.png and app/favicon.ico by file convention; these
// tests hold the drawing to the design's tokens and the two rendered files to their formats.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync("app/globals.css", "utf8");
const svg = readFileSync("app/icon.svg", "utf8");

/** `--color-<name>: #hex;` inside the first block that `selector` opens. */
function token(block: string, name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6});`, "i").exec(block);
  if (!match?.[1]) throw new Error(`no --color-${name} in block`);
  return match[1].toLowerCase();
}

function blockAfter(source: string, opener: string): string {
  const start = source.indexOf(opener);
  if (start < 0) throw new Error(`no ${opener}`);
  return source.slice(start, source.indexOf("}", start));
}

/** `.class { fill: #hex; }` in the part of the SVG's style before or inside the dark media query. */
function fill(part: string, name: string): string {
  const match = new RegExp(`\\.${name}\\s*\\{\\s*fill:\\s*(#[0-9a-f]{6});`, "i").exec(part);
  if (!match?.[1]) throw new Error(`no .${name} fill`);
  return match[1].toLowerCase();
}

describe("the app icon is drawn in the design's tokens (D-069 C14)", () => {
  const light = blockAfter(css, ":root {");
  const dark = blockAfter(css, ':root[data-theme="dark"] {');
  const [lightStyle, darkStyle] = svg.split("@media (prefers-color-scheme: dark)");

  it("uses paper, ink and spot from app/globals.css in the light print run", () => {
    for (const name of ["paper", "ink", "spot"]) {
      expect(fill(lightStyle ?? "", name), name).toBe(token(light, name));
    }
  });

  it("follows the device into the dark print run with the dark tokens", () => {
    for (const name of ["paper", "ink", "spot"]) {
      expect(fill(darkStyle ?? "", name), name).toBe(token(dark, name));
    }
  });

  it("is square, because a flyer is cut, not rounded", () => {
    expect(svg).toContain('viewBox="0 0 32 32"');
    expect(svg).not.toMatch(/\brx=|\bry=|<circle/);
  });

  it("ships a 180px PNG for iOS and a PNG-in-ICO favicon", () => {
    const png = readFileSync("app/apple-icon.png");
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    // IHDR: width and height, big-endian, at bytes 16 and 20.
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([180, 180]);

    const ico = readFileSync("app/favicon.ico");
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]);
    const count = ico.readUInt16LE(4);
    expect(count).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < count; i += 1) {
      const size = ico.readUInt32LE(6 + 16 * i + 8);
      const offset = ico.readUInt32LE(6 + 16 * i + 12);
      expect(offset + size).toBeLessThanOrEqual(ico.length);
      expect(ico.subarray(offset, offset + 4)).toEqual(Buffer.from([137, 80, 78, 71]));
    }
  });
});
