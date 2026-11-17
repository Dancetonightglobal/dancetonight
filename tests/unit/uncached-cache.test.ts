import { describe, expect, it } from "vitest";
import type { ExtractionCache, CachedExtraction } from "@/src/pipeline/extract";
import { withoutCachedReads } from "@/src/pipeline/uncached-cache";

describe("withoutCachedReads", () => {
  it("get resolves to null and never calls inner get", async () => {
    const innerGets: Array<{ textHash: string; promptVersion: string }> = [];
    const innerPuts: Array<{ textHash: string; promptVersion: string; value: CachedExtraction }> =
      [];

    const fakeCache: ExtractionCache = {
      get: async (textHash: string, promptVersion: string) => {
        innerGets.push({ textHash, promptVersion });
        return { extraction: {} as unknown as CachedExtraction["extraction"], model: "fake-model" };
      },
      put: async (textHash: string, promptVersion: string, value: CachedExtraction) => {
        innerPuts.push({ textHash, promptVersion, value });
      },
    };

    const wrapper = withoutCachedReads(fakeCache);
    const result = await wrapper.get("some-hash", "some-version");

    expect(result).toBeNull();
    expect(innerGets).toHaveLength(0);
  });

  it("put calls inner put once with the same three arguments", async () => {
    const innerGets: Array<{ textHash: string; promptVersion: string }> = [];
    const innerPuts: Array<{ textHash: string; promptVersion: string; value: CachedExtraction }> =
      [];

    const fakeCache: ExtractionCache = {
      get: async (textHash: string, promptVersion: string) => {
        innerGets.push({ textHash, promptVersion });
        return null;
      },
      put: async (textHash: string, promptVersion: string, value: CachedExtraction) => {
        innerPuts.push({ textHash, promptVersion, value });
      },
    };

    const wrapper = withoutCachedReads(fakeCache);
    const value = {
      extraction: { listings: [] } as unknown as CachedExtraction["extraction"],
      model: "test-model",
    } as CachedExtraction;

    await wrapper.put("test-hash", "test-version", value);

    expect(innerPuts).toHaveLength(1);
    expect(innerPuts[0]).toEqual({
      textHash: "test-hash",
      promptVersion: "test-version",
      value,
    });
    expect(innerGets).toHaveLength(0);
  });
});
