/**
 * The layer half of `repo/boundaries`: `lint.boundaries` as sync writes it into the rule's options, and the message
 * for a package import whose target's tag the importer's tag may not import.
 */
import type { CreateRule } from "@oxlint/plugins";

import { isRecord } from "./manifest.ts";

/** Each package name's one tag, and per tag the other tags its packages may import. */
export type Tags = { tags: Readonly<Record<string, string>>; allow: Readonly<Record<string, readonly string[]>> };

/** What a rule's `meta.schema` takes. */
type RuleSchema = NonNullable<NonNullable<CreateRule["meta"]>["schema"]>;

const CONFIG_FILE = "workerstack.config.ts";
/** A tag read with "an" before it: `app`, `infra`; `ui` and `lib` take "a". */
const AN_TAG = /^[aeio]/i;
/** British English: "app, ui or lib", no serial comma. */
const LIST_LOCALE = "en-GB";

/** The options' JSON schema, which oxlint checks `["error", {…}]` against before the rule sees it. */
export const TAGS_SCHEMA: RuleSchema = [
  {
    additionalProperties: false,
    properties: {
      allow: { additionalProperties: { items: { type: "string" }, type: "array" }, type: "object" },
      tags: { additionalProperties: { type: "string" }, type: "object" },
    },
    required: ["allow", "tags"],
    type: "object",
  },
];

/** A string record of `value`, or null when it is not one. */
function stringsOf(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value).flatMap(([key, tag]): [string, string][] =>
    typeof tag === "string" ? [[key, tag]] : [],
  );
  return entries.length === Object.keys(value).length ? Object.fromEntries(entries) : null;
}

/** A record of string lists of `value`, or null when it is not one. */
function listsOf(value: unknown): Record<string, string[]> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value).flatMap(([key, list]): [string, string[]][] =>
    Array.isArray(list) && list.every((tag) => typeof tag === "string") ? [[key, list]] : [],
  );
  return entries.length === Object.keys(value).length ? Object.fromEntries(entries) : null;
}

/** No package tagged: what the rule judges by when sync wrote no options. */
const UNTAGGED: Tags = { allow: {}, tags: {} };

/** The tags in the rule's first option; none when sync wrote no options, so the rule judges no tag. */
export function tagsOf(options: readonly unknown[]): Tags {
  const [first] = options;
  if (!isRecord(first)) return UNTAGGED;
  const tags = stringsOf(first.tags);
  const allow = listsOf(first.allow);
  return tags === null || allow === null ? UNTAGGED : { allow, tags };
}

/** `tag` with its article: "a ui", "an app". */
function articled(tag: string): string {
  return `${AN_TAG.test(tag) ? "an" : "a"} ${tag}`;
}

/** `lib`, `app or lib`, `app, ui or lib`. */
function listOf(names: readonly string[]): string {
  return new Intl.ListFormat(LIST_LOCALE, { type: "disjunction" }).format(names);
}

/**
 * Why the package `from` may not import the package `to`, or null when it may: an untagged (or nameless) side is not
 * judged, and a tag may import its own tag and the ones `allow` lists for it.
 */
export function tagProblem({ tags, allow }: Tags, from: string | null, to: string): string | null {
  const own = from === null ? undefined : tags[from];
  const target = tags[to];
  if (own === undefined || target === undefined || own === target) return null;
  const allowed = allow[own] ?? [];
  if (allowed.includes(target)) return null;
  const may = listOf([own, ...allowed.filter((tag) => tag !== own)]);
  const fix = `move what it needs into a package ${own} may import, or add "${target}" to lint.boundaries.allow.${own}`;
  const why = `"${to}" is ${articled(target)} package, and ${articled(own)} package may import only ${may}`;
  return `${why}; ${fix} in ${CONFIG_FILE}`;
}
