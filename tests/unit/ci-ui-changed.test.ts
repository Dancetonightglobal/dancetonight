import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

// D-881: a pull request runs the browser suite only when a changed file is part of the site.
function uiChanged(files: string[]): string {
  return execFileSync("node", ["scripts/ci-ui-changed.mjs"], {
    input: files.join("\n"),
    encoding: "utf8",
  }).trim();
}

describe("scripts/ci-ui-changed.mjs (D-881)", () => {
  it("runs the suite for a site or build file", () => {
    expect(uiChanged(["app/page.tsx"])).toBe("true");
    expect(uiChanged(["src/ui/EventCard.tsx", "config/sources/london.ts"])).toBe("true");
    expect(uiChanged(["pnpm-lock.yaml"])).toBe("true");
    expect(uiChanged([".github/workflows/ci.yml"])).toBe("true");
  });

  it("runs the suite for a file the site's imports reach", () => {
    expect(uiChanged(["src/domain/time.ts"])).toBe("true");
    expect(uiChanged(["config/styles.ts"])).toBe("true");
  });

  it("skips it for city configs and pipeline rules the site never loads", () => {
    expect(uiChanged(["config/sources/london.ts"])).toBe("false");
    expect(uiChanged(["src/domain/dedupe.ts", "tests/unit/dedupe-street-point-twin.test.ts"])).toBe(
      "false",
    );
    expect(uiChanged(["src/pipeline/ingest.ts", "src/adapters/feeds/jsonld.ts"])).toBe("false");
  });

  it("runs it when no file list came through", () => {
    expect(uiChanged([])).toBe("true");
  });
});
