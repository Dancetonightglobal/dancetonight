import { httpUrl, decodeEntities } from "@/src/adapters/shared";

const MAX_HTML_LENGTH = 2_000_000;
const MAX_EVENT_SCOPES = 500;
const MAX_VALUE_LENGTH = 2_000;
const VOID_TAG = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/;

function isEventType(itemtype: string): boolean {
  const normalized = itemtype.trim().toLowerCase();
  if (normalized.startsWith("https://schema.org/") || normalized.startsWith("http://schema.org/")) {
    const lastSegment = normalized.split("/").pop()!;
    return lastSegment === "event" || lastSegment.endsWith("event");
  }
  return false;
}

function extractAttr(tag: string, attrName: string): string | null {
  // Look for attr="value" or attr='value'
  const re = new RegExp(`\\s${attrName}\\s*=\\s*(["'])(.*?)\\1`, "i");
  const match = re.exec(tag);
  if (match?.[2] !== undefined) {
    return decodeEntities(match[2]);
  }
  // Look for attr=value (unquoted)
  const reUnquoted = new RegExp(`\\s${attrName}\\s*=\\s*([^\\s>]+)`, "i");
  const matchUnquoted = reUnquoted.exec(tag);
  if (matchUnquoted?.[1] !== undefined) {
    return decodeEntities(matchUnquoted[1]);
  }
  // For boolean attributes like itemscope (no value)
  const reBool = new RegExp(`\\s${attrName}(?![\\w-])`, "i");
  if (reBool.test(tag)) {
    return "";
  }
  return null;
}

function normalizeDateTime(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Handle date only
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/;
  if (dateOnly.test(trimmed)) {
    const m = trimmed.match(dateOnly)!;
    return `${m[1]}-${m[2]}-${m[3]}`;
  }

  // Handle date time with space separator
  const dateTimeSpace = /^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2})(?::(\d{2}))?$/;
  let m = trimmed.match(dateTimeSpace);
  if (m) {
    const hour = m[4]!.padStart(2, "0");
    const minute = m[5]!;
    const second = m[6] || "00";
    return `${m[1]}-${m[2]}-${m[3]}T${hour}:${minute}:${second}`;
  }

  // Handle ISO format with T
  const dateTimeT = /^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})(?::(\d{2}))?$/i;
  m = trimmed.match(dateTimeT);
  if (m) {
    const hour = m[4]!.padStart(2, "0");
    const minute = m[5]!;
    const second = m[6] || "00";
    return `${m[1]}-${m[2]}-${m[3]}T${hour}:${minute}:${second}`;
  }

  // Handle with offset
  const withOffset =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(Z|[+-]\d{1,2}:?\d{2})?$/i;
  m = trimmed.match(withOffset);
  if (m) {
    const year = m[1]!;
    const month = m[2]!;
    const day = m[3]!;
    if (!m[4]) {
      // Date only
      return `${year}-${month}-${day}`;
    }
    const hour = m[4]!.padStart(2, "0");
    const minute = m[5]!;
    const second = m[6] || "00";
    const offset = m[7] || "";
    return `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
  }

  return null;
}

function getPropertyValue(tag: string, innerText: string): string | null {
  const tagNameMatch = tag.match(/^<([a-zA-Z][a-zA-Z0-9]*)/i);
  if (!tagNameMatch) return null;
  const tagName = tagNameMatch[1]!.toLowerCase();

  let value: string | null = null;

  if (tagName === "meta") {
    value = extractAttr(tag, "content");
  } else if (tagName === "link" || tagName === "a") {
    value = extractAttr(tag, "href");
  } else if (tagName === "time") {
    value = extractAttr(tag, "datetime");
    if (!value) value = extractAttr(tag, "data-raw");
    if (!value) value = extractAttr(tag, "content");
    if (!value) value = decodeEntities(innerText.trim());
  } else {
    value = extractAttr(tag, "content");
    if (!value) {
      const stripped = innerText
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      value = decodeEntities(stripped) || null;
    }
  }

  // Attribute values are decoded once by extractAttr, text once above: never twice ("&amp;lt;" stays "&lt;").
  if (value !== null) {
    value = value.trim();
    if (value.length > MAX_VALUE_LENGTH) {
      value = value.substring(0, MAX_VALUE_LENGTH);
    }
  }
  return value;
}

export function microdataEvents(html: string, pageUrl: string): Record<string, unknown>[] {
  if (html.length > MAX_HTML_LENGTH) {
    html = html.substring(0, MAX_HTML_LENGTH);
  }

  // Comments can hold markup ("<!-- NAME -->" is harmless, a commented-out card is not).
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  const events: Record<string, unknown>[] = [];
  const stack: Array<{ node: Record<string, unknown>; depth: number }> = [];
  // Top-level Event nodes, and nodes whose properties go nowhere (a Product, an unnamed nested scope).
  const eventNodes = new WeakSet<Record<string, unknown>>();
  const throwaway = new WeakSet<Record<string, unknown>>();
  let currentDepth = 0;
  let inScript = false;
  let inStyle = false;

  // Simple tag scanner
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  let match;
  while ((match = tagRe.exec(html)) !== null) {
    const isClose = !!match[1];
    const tagName = match[2]!.toLowerCase();
    const attrs = match[3] || "";
    const fullTag = match[0];

    // Skip script and style content
    if (tagName === "script") {
      if (isClose) inScript = false;
      else inScript = true;
      continue;
    }
    if (tagName === "style") {
      if (isClose) inStyle = false;
      else inStyle = true;
      continue;
    }
    if (inScript || inStyle) continue;

    const hasScope = extractAttr(` ${attrs}`, "itemscope") !== null;
    const itemtype = extractAttr(` ${attrs}`, "itemtype");
    const itemprop = extractAttr(` ${attrs}`, "itemprop");

    if (isClose) {
      // The element that opened the innermost scope closes it.
      if (stack.length > 0 && stack[stack.length - 1]!.depth === currentDepth) {
        const popped = stack.pop()!;
        if (eventNodes.has(popped.node) && popped.node.name && popped.node.startDate) {
          events.push(popped.node);
        }
      }
      currentDepth = Math.max(0, currentDepth - 1);
      continue;
    }

    // A void or self-closed element opens no frame, so it never changes the depth.
    const isVoid = VOID_TAG.test(tagName) || fullTag.endsWith("/>");
    if (!isVoid) currentDepth++;

    if (hasScope && !isVoid) {
      const parent = stack.length > 0 ? stack[stack.length - 1]!.node : null;
      let node: Record<string, unknown> = {};
      if (parent === null) {
        // A top-level scope: an Event is read, any other type (a Product) is a throwaway node.
        if (itemtype && isEventType(itemtype) && events.length < MAX_EVENT_SCOPES) {
          node = { "@type": "Event" };
          eventNodes.add(node);
        }
      } else if (itemprop && !throwaway.has(parent)) {
        // A nested scope (location, address, offers, organizer) is its parent's property.
        node = { "@type": (itemtype ?? "").split("/").pop() || "Thing" };
        if (parent[itemprop] === undefined) parent[itemprop] = node;
      }
      if (!eventNodes.has(node) && node["@type"] === undefined) throwaway.add(node);
      stack.push({ node, depth: currentDepth });
    } else if (itemprop && stack.length > 0) {
      const currentNode = stack[stack.length - 1]!.node;
      const tagEnd = match.index + fullTag.length;
      const nextTag = html.substring(tagEnd).search(/<[^>]*>/);
      const innerText = html.substring(tagEnd, nextTag === -1 ? html.length : tagEnd + nextTag);
      const value = getPropertyValue(fullTag, innerText);
      // First value wins; the Event itself takes no url (the list page stays its source).
      const skip =
        value === null ||
        throwaway.has(currentNode) ||
        currentNode[itemprop] !== undefined ||
        (itemprop === "url" && eventNodes.has(currentNode));
      if (!skip && value !== null) {
        if (itemprop === "startDate" || itemprop === "endDate") {
          const normalized = normalizeDateTime(value);
          if (normalized) currentNode[itemprop] = normalized;
        } else if (itemprop === "url" || itemprop === "image") {
          const url = httpUrl(value, pageUrl);
          if (url) currentNode[itemprop] = url;
        } else {
          currentNode[itemprop] = value;
        }
      }
    }
  }

  // Filter events: must have name and startDate
  const validEvents = events.filter((e) => e.name && e.startDate);

  // Set @id for each event
  for (const event of validEvents) {
    const offer = event.offers as Record<string, unknown> | undefined;
    const offerUrl = offer?.url;
    if (typeof offerUrl === "string") {
      const id = httpUrl(offerUrl, pageUrl);
      if (id) {
        event["@id"] = id;
      } else {
        event["@id"] = `${pageUrl}#${event.name}|${event.startDate}`;
      }
    } else {
      event["@id"] = `${pageUrl}#${event.name}|${event.startDate}`;
    }

    // Remove undefined values
    Object.keys(event).forEach((key) => {
      if (event[key] === undefined) {
        delete event[key];
      }
    });
  }

  return validEvents;
}
