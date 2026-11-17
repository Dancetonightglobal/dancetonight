/**
 * Amazon Bedrock provider, serving DeepSeek V3.2 for every job, metered in microdollars.
 *
 * The owner decided (2026-10-12) that every AI job moves to paid DeepSeek V3.2 on Bedrock under a
 * $1/day cap, with the free providers kept as an outage fallback.
 *
 * This adapter is switched on only by BOTH the dedicated Bedrock IAM user's keys and
 * AI_ENABLE_PAID (same structural switch as Anthropic). Requests are signed with AWS Signature
 * Version 4 using the dependency-free `./sigv4` module (no AWS SDK). Structured output is a JSON
 * reply validated by `decodeResult`; the model is asked for JSON in the prompt.
 */

import type {
  AiJob,
  AiModel,
  AiOutcome,
  AiProvider,
  AiProviderMeta,
  AiRequest,
} from "@/src/ai/types";
import { providerMeta } from "@/src/ai/registry";
import {
  asArray,
  asRecord,
  credential,
  decodeResult,
  estimateProviderCost,
  fail,
  guardedSystem,
  microdollarUsage,
  parseFlag,
  readAt,
  readCount,
  readString,
  requestJson,
  sanitizeDetail,
  untrustedBlock,
  resolveProviderOptions,
  type ProviderOptions,
  type ResolvedProviderOptions,
} from "@/src/ai/providers/index";
import { signRequest, type SigV4Credentials } from "@/src/ai/providers/sigv4";
import { BEDROCK_REGION } from "@/src/ai/registry";

export const BEDROCK_META: AiProviderMeta = providerMeta("bedrock");

export function bedrockConverseUrl(modelId: string, region = BEDROCK_REGION): string {
  return `https://bedrock-runtime.${region}.amazonaws.com/model/${modelId}/converse`;
}

/**
 * Both halves of the switch: the dedicated Bedrock IAM user's keys on their own are not enough.
 *
 * `enablePaid` is the parsed boolean `src/config/env.ts` produces; `parseFlag` also accepts the
 * raw spellings, for a caller injecting an unparsed environment.
 */
export function bedrockEnabled(
  accessKeyId: string | undefined,
  secretAccessKey: string | undefined,
  enablePaid: string | boolean | undefined,
): boolean {
  return (
    credential(accessKeyId) !== undefined &&
    credential(secretAccessKey) !== undefined &&
    parseFlag(enablePaid)
  );
}

/**
 * Bedrock calls get three minutes, not the shared 30 s: DeepSeek V3.2 wrote about 45 tokens a
 * second in ingest run 38502952077 (1,132 tokens in 25 s), so a list page's extraction outruns
 * 30 s; four calls timed out there and each one's page fell to the slower Workers AI fallback.
 */
export const BEDROCK_TIMEOUT_MS = 180_000;

export function createBedrockProvider(options?: ProviderOptions): AiProvider {
  const resolved = resolveProviderOptions({
    ...options,
    timeoutMs: options?.timeoutMs ?? BEDROCK_TIMEOUT_MS,
  });
  return {
    meta: BEDROCK_META,
    isConfigured(): boolean {
      return bedrockEnabled(
        resolved.env.BEDROCK_ACCESS_KEY_ID,
        resolved.env.BEDROCK_SECRET_ACCESS_KEY,
        resolved.env.AI_ENABLE_PAID,
      );
    },
    estimateCost(job: AiJob, model: AiModel): number {
      return estimateProviderCost(job, model, "microdollar");
    },
    call<T>(request: AiRequest<T>, model: AiModel): Promise<AiOutcome<T>> {
      return callBedrock(request, model, resolved);
    },
  };
}

async function callBedrock<T>(
  request: AiRequest<T>,
  model: AiModel,
  options: ResolvedProviderOptions,
): Promise<AiOutcome<T>> {
  const accessKeyId = credential(options.env.BEDROCK_ACCESS_KEY_ID);
  const secretAccessKey = credential(options.env.BEDROCK_SECRET_ACCESS_KEY);
  const sessionToken = credential(options.env.BEDROCK_SESSION_TOKEN);
  if (
    !bedrockEnabled(
      options.env.BEDROCK_ACCESS_KEY_ID,
      options.env.BEDROCK_SECRET_ACCESS_KEY,
      options.env.AI_ENABLE_PAID,
    ) ||
    accessKeyId === undefined ||
    secretAccessKey === undefined
  ) {
    return fail(
      "bedrock",
      "disabled",
      "the paid path is off: BEDROCK_ACCESS_KEY_ID, BEDROCK_SECRET_ACCESS_KEY and AI_ENABLE_PAID must all be set",
    );
  }

  // Model id sanity check
  if (!/^[A-Za-z0-9._:-]+$/.test(model.id)) {
    return fail("bedrock", "provider_error", "unexpected model id");
  }

  const profile = credential(options.env.BEDROCK_INFERENCE_PROFILE_ARN);
  if (
    profile !== undefined &&
    !/^arn:aws:bedrock:[a-z0-9-]+:\d{12}:application-inference-profile\/[a-z0-9]+$/.test(profile)
  ) {
    return fail(
      "bedrock",
      "provider_error",
      "BEDROCK_INFERENCE_PROFILE_ARN is not an application inference profile ARN",
    );
  }

  const block = untrustedBlock(request.user);
  const body = {
    system: [{ text: guardedSystem(request.system, block) }],
    messages: [{ role: "user", content: [{ text: block.text }] }],
    inferenceConfig: { maxTokens: request.job.maxOutputTokens },
  };
  const bodyText = JSON.stringify(body);
  const url = bedrockConverseUrl(encodeURIComponent(profile ?? model.id), BEDROCK_REGION);

  const credentials: SigV4Credentials = {
    accessKeyId,
    secretAccessKey,
    sessionToken,
  };
  const headers = signRequest({
    method: "POST",
    url,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: bodyText,
    region: BEDROCK_REGION,
    service: "bedrock",
    credentials,
    now: new Date(),
  });

  const outcome = await requestJson(
    url,
    {
      method: "POST",
      headers,
      body: bodyText,
    },
    options,
  );
  const secrets = [accessKeyId, secretAccessKey, sessionToken];

  if (outcome.kind === "transport") {
    return fail("bedrock", "provider_error", sanitizeDetail(outcome.detail, secrets));
  }
  if (outcome.status === 429) {
    return fail("bedrock", "quota_exhausted", "HTTP 429: Bedrock throttled the request");
  }
  if (outcome.status !== 200) {
    const message =
      readString(readAt(outcome.body, "message")) ??
      readString(readAt(outcome.body, "Message")) ??
      "no message";
    return fail(
      "bedrock",
      "provider_error",
      sanitizeDetail(`HTTP ${outcome.status}: ${message}`, secrets, request.user),
    );
  }

  const inputTokens =
    readCount(readAt(outcome.body, "usage", "inputTokens")) ?? request.job.estimatedInputTokens;
  const outputTokens = readCount(readAt(outcome.body, "usage", "outputTokens")) ?? 0;
  const usage = microdollarUsage(model, inputTokens, outputTokens);

  if (readString(readAt(outcome.body, "stopReason")) === "max_tokens") {
    return fail(
      "bedrock",
      "truncated",
      `stopReason max_tokens at ${request.job.maxOutputTokens} output tokens`,
    );
  }

  const output = asRecord(readAt(outcome.body, "output"));
  const message = asRecord(readAt(output, "message"));
  const content = asArray(readAt(message, "content"));
  let text = "";
  if (content) {
    for (const block of content) {
      const record = asRecord(block);
      const blockText = readString(readAt(record, "text"));
      if (blockText !== null) text += blockText;
    }
  }
  if (text === "") {
    return fail("bedrock", "provider_error", "reply carried no text");
  }
  return decodeResult("bedrock", model.id, text, request.schema, usage);
}

/** The adapter bound to the process environment. */
export const bedrockProvider: AiProvider = createBedrockProvider();
