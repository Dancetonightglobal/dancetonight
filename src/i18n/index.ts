// UI string lookup with typed keys and typed params. `t("home.header.tonight", { place })`
// compiles only when the key exists and every `{placeholder}` in that string is supplied.
// Plural leaves ({ zero?, one, other }) pick a form from `count` (ICU-lite; English only in v1,
// so the selection uses Intl.PluralRules for "en" and a literal zero form when one is written).
//
// Pure: no I/O, no React, safe in server and client bundles.

import { en } from "@/src/i18n/en";

export { en } from "@/src/i18n/en";
export type { Strings } from "@/src/i18n/en";

// A plural leaf. `zero` is optional and chosen only for count 0; English has no other categories.
export type PluralForms = {
  readonly zero?: string;
  readonly one: string;
  readonly other: string;
};

type Leaf = string | PluralForms;

// Every dot path from the root of `en` to a string or plural leaf.
type Paths<T, Prefix extends string = ""> = T extends string
  ? Prefix
  : T extends PluralForms
    ? Prefix
    : {
        [K in keyof T & string]: Paths<T[K], Prefix extends "" ? K : `${Prefix}.${K}`>;
      }[keyof T & string];

export type TranslationKey = Paths<typeof en>;

// The leaf type at a dot path.
type LeafAt<T, P extends string> = P extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? LeafAt<T[Head], Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never;

// Placeholder names inside a string literal type: "Starts in {duration}, until {until}" gives
// "duration" | "until".
type PlaceholderNames<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | PlaceholderNames<Rest>
  : never;

type LeafPlaceholders<L> = L extends string
  ? PlaceholderNames<L>
  : L extends PluralForms
    ? | "count"
      | PlaceholderNames<L["one"]>
      | PlaceholderNames<L["other"]>
      | PlaceholderNames<Extract<L["zero"], string>>
    : never;

type ParamValue = string | number;

// The params object a key needs. `count` is a number when the leaf is plural.
export type Params<K extends TranslationKey> = {
  [Name in LeafPlaceholders<LeafAt<typeof en, K>>]: Name extends "count" ? number : ParamValue;
};

// No params argument when the string has no placeholders; a required one otherwise.
type ParamsArg<K extends TranslationKey> = [LeafPlaceholders<LeafAt<typeof en, K>>] extends [never]
  ? []
  : [params: Params<K>];

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

const pluralRules = new Intl.PluralRules("en");
const numberFormat = new Intl.NumberFormat("en");

function isPluralForms(value: unknown): value is PluralForms {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { one?: unknown }).one === "string" &&
    typeof (value as { other?: unknown }).other === "string"
  );
}

function lookup(key: string): Leaf {
  let node: unknown = en;
  for (const segment of key.split(".")) {
    if (typeof node !== "object" || node === null || !(segment in node)) {
      throw new Error(`Unknown UI string key: ${key}`);
    }
    node = (node as Record<string, unknown>)[segment];
  }
  if (typeof node === "string" || isPluralForms(node)) return node;
  throw new Error(`UI string key does not point at a string: ${key}`);
}

// Pick the plural form for a count. Zero uses the literal zero form when the leaf has one.
export function plural(count: number, forms: PluralForms): string {
  if (count === 0 && forms.zero !== undefined) return forms.zero;
  return pluralRules.select(count) === "one" ? forms.one : forms.other;
}

// Fill `{name}` placeholders. Values are inserted verbatim, never re-parsed for placeholders,
// so a value containing "{count}" or "$&" stays literal. Numbers are formatted for English.
export function interpolate(
  template: string,
  params: Readonly<Record<string, ParamValue>>,
): string {
  return template.replace(PLACEHOLDER, (_match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) {
      throw new Error(`Missing param "${name}" for UI string "${template}"`);
    }
    const value = params[name];
    return typeof value === "number" ? numberFormat.format(value) : String(value);
  });
}

// The string for a key, with its placeholders filled.
export function t<K extends TranslationKey>(key: K, ...args: ParamsArg<K>): string {
  const params: Readonly<Record<string, ParamValue>> = args[0] ?? {};
  const leaf = lookup(key);
  if (typeof leaf === "string") return interpolate(leaf, params);
  const count = params["count"];
  if (typeof count !== "number") {
    throw new Error(`UI string "${key}" is plural and needs a numeric count`);
  }
  return interpolate(plural(count, leaf), params);
}

// Every key, in source order. Used by tests and by tooling that audits the strings.
export function keys(): TranslationKey[] {
  const out: string[] = [];
  const walk = (node: unknown, prefix: string): void => {
    if (typeof node === "string" || isPluralForms(node)) {
      out.push(prefix);
      return;
    }
    if (typeof node === "object" && node !== null) {
      for (const [name, child] of Object.entries(node)) {
        walk(child, prefix === "" ? name : `${prefix}.${name}`);
      }
    }
  };
  walk(en, "");
  return out as TranslationKey[];
}

// Placeholder names found in a template, in order of first appearance.
export function placeholders(template: string): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}
