// `pnpm ai:probe`: times one extraction on Workers AI under several response formats, so a slow
// or runaway reply is diagnosed in one short run instead of one full ingest per guess (D-055).
//
// Ingest runs 18 and 19 timed out on nearly every page, and run 19 on pages that had answered in
// 1 to 2 seconds before the grammar was bounded. The probe separates the causes: it sends the same
// small made-up page (no third-party text) with each format and prints how long the call took, how
// many tokens came back, and whether the reply passed validation. Nothing is stored.
//
// Formats:
//   bounded     the schema the pipeline sends today (closed maps, maximum lengths and counts)
//   closed      closed maps only, no maximum lengths or counts
//   open        the schema zod produces, unchanged (before D-054)
//   none        no response_format at all: the model writes JSON from the prompt alone
//
// Each call is capped at 3,000 output tokens and 120 seconds. A probe costs well under 100 neurons.

import { z } from "zod";

import { createCloudflareProvider } from "@/src/ai/providers/cloudflare";
import { EXTRACT_SYSTEM, boundExtractionSchema, extractUserTurn } from "@/src/ai/prompts";
import { modelFor, type AiJob } from "@/src/ai";
import { rawExtractionSchema } from "@/src/domain/listing";

/** A made-up page: three events, no third-party text. */
export const PROBE_PAGE = [
  "Upcoming socials",
  "",
  "Friday October 2: Salsa social at Example Hall, 12 Sample Street, Brooklyn. Lesson 8pm, dancing 9pm to 1am. $20 at the door, $15 advance.",
  "",
  "Saturday October 3: Bachata night at Test Studio, 34 Placeholder Ave, Queens. Doors 9pm. $15.",
  "",
  "Every Thursday: Beginner swing class at Demo Ballroom, 56 Specimen Road, Manhattan, 7:30pm, then open dancing until 11pm. Free for members, $10 otherwise.",
].join("\n");

const PROBE_JOB: AiJob = {
  id: "extract",
  sendsUntrustedText: true,
  maxOutputTokens: 3_000,
  estimatedInputTokens: 2_500,
  description: "extraction probe (pnpm ai:probe)",
};

export function probeFormats(): { name: string; schema: Record<string, unknown> | null }[] {
  const zodSchema = z.toJSONSchema(rawExtractionSchema, {
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  return [
    { name: "bounded", schema: boundExtractionSchema(zodSchema) as Record<string, unknown> },
    {
      name: "closed",
      schema: boundExtractionSchema(zodSchema, undefined, { lengths: false }) as Record<
        string,
        unknown
      >,
    },
    { name: "open", schema: zodSchema },
    { name: "none", schema: null },
  ];
}

async function main(): Promise<number> {
  const provider = createCloudflareProvider();
  if (!provider.isConfigured()) {
    console.log("cloudflare: not configured; nothing to probe");
    return 0;
  }
  const base = modelFor("cloudflare", "extract");
  if (!base) throw new Error("no Cloudflare model is registered for extraction");
  const user = extractUserTurn(
    { url: "https://probe.example/", today: "2026-10-01", tz: "America/New_York" },
    PROBE_PAGE,
  );
  for (const format of probeFormats()) {
    const model = format.schema ? base : { ...base, supportsJsonSchema: false };
    const started = Date.now();
    const outcome = await provider.call(
      {
        job: PROBE_JOB,
        system: EXTRACT_SYSTEM,
        user,
        schema: rawExtractionSchema,
        jsonSchema: format.schema ?? {},
      },
      model,
    );
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (outcome.ok) {
      console.log(
        `${format.name}: ok in ${seconds} s; ${outcome.usage.inputTokens} in, ${outcome.usage.outputTokens} out; ${outcome.value.listings.length} listings`,
      );
    } else {
      console.log(`${format.name}: ${outcome.reason} in ${seconds} s; ${outcome.detail}`);
    }
  }
  return 0;
}

if (process.argv[1]?.endsWith("ai-probe.ts")) {
  main().then((code) => process.exit(code));
}
