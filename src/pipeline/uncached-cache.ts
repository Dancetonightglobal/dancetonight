import type { ExtractionCache, CachedExtraction } from "@/src/pipeline/extract";

/** A cache that serves nothing but still stores (a source's `extractUncached`, D-480). */
export function withoutCachedReads(cache: ExtractionCache): ExtractionCache {
  return {
    get: async (): Promise<CachedExtraction | null> => {
      return null;
    },
    put: async (
      textHash: string,
      promptVersion: string,
      value: CachedExtraction,
    ): Promise<void> => {
      return cache.put(textHash, promptVersion, value);
    },
  };
}
