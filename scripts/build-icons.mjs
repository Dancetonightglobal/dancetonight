// Renders the PNG and ICO icons from app/icon.svg (D-069), so the three icons are one drawing.
// Run by hand after changing the SVG: `node scripts/build-icons.mjs`. The outputs are committed.
//
// - app/apple-icon.png, 180x180: iOS uses it for a home-screen bookmark (it takes no SVG) and
//   rounds the corners itself.
// - app/favicon.ico, 16 and 32 px PNGs in one ICO: what a browser or a crawler asks for at
//   /favicon.ico before it reads any <link rel="icon">; the live site answered that with a 404.
//
// sharp is not a dependency of this project; it ships with Next.js, so it is resolved from there.

import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromNext = createRequire(createRequire(import.meta.url).resolve("next/package.json"));
const sharp = requireFromNext("sharp");

const svg = await readFile(path.join(root, "app/icon.svg"));

async function png(size) {
  // librsvg ignores the prefers-color-scheme block, so the PNGs are the light print run, which
  // is what an iOS home screen and a crawler's favicon both expect.
  return sharp(svg, { density: Math.ceil((72 * size) / 32) })
    .resize(size, size)
    .png()
    .toBuffer();
}

/** An ICO whose entries are PNGs (supported by every browser since Windows Vista's format). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

await writeFile(path.join(root, "app/apple-icon.png"), await png(180));
await writeFile(
  path.join(root, "app/favicon.ico"),
  ico([
    { size: 16, data: await png(16) },
    { size: 32, data: await png(32) },
  ]),
);
console.log("wrote app/apple-icon.png and app/favicon.ico from app/icon.svg");
