// Whether a pull request's changed files can change the site (D-881): prints "true" or "false".
// Usage: git diff --name-only BASE HEAD | node scripts/ci-ui-changed.mjs
// True when a changed file is under a path the site is built or tested from (CORE), or is reached by
// static imports from app/ or src/ui/. The browser suite runs only then on a pull request; the
// nightly run on main runs it always, so a miss here is caught within a day.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const CORE =
  /^(app\/|src\/ui\/|src\/i18n\/|src\/data\/|public\/|tests\/e2e\/|package\.json$|pnpm-lock\.yaml$|tsconfig\.json$|next\.config\.|playwright\.config\.|proxy\.ts$|scripts\/ci-ui-changed\.mjs$|\.github\/workflows\/ci\.yml$)/;
const EXTS = [".ts", ".tsx", ".js", ".mjs", ".json", "/index.ts", "/index.tsx", "/index.js"];
const IMPORT =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolve(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(root, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  for (const e of EXTS) if (fs.existsSync(base + e)) return base + e;
  return null;
}

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(f.name) && !/\.test\./.test(f.name)) out.push(p);
  }
  return out;
}

function reached() {
  const seen = new Set();
  const stack = [...walk(path.join(root, "app"), []), ...walk(path.join(root, "src/ui"), [])];
  while (stack.length > 0) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (!/\.(ts|tsx|js|mjs)$/.test(f)) continue;
    for (const m of fs.readFileSync(f, "utf8").matchAll(IMPORT)) {
      // `import type` / `export type` is erased at build: it loads nothing at runtime.
      if (/^(import|export)\s+type\s/.test(m[0])) continue;
      const r = resolve(f, m[1] ?? m[2] ?? m[3] ?? m[4]);
      if (r && !seen.has(r)) stack.push(r);
    }
  }
  return new Set([...seen].map((f) => path.relative(root, f)));
}

const changed = fs
  .readFileSync(0, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);
// No list read: run the suite, a doubt runs it.
if (changed.length === 0) {
  console.log("true");
} else if (changed.some((f) => CORE.test(f))) {
  console.log("true");
} else {
  const site = reached();
  console.log(changed.some((f) => site.has(f)) ? "true" : "false");
}
