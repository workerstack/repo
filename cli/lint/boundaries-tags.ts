/**
 * The layer half of `repo/boundaries`: `lint.boundaries` as sync writes it into the rule's options, and the message
 * for a package import whose target's tag the importer's tag may not import.
 */

import type { RepoRule } from "./rule.types.ts";

/** Each package name's one tag, and per tag the other tags its packages may import. */
export type Tags = { tags: Readonly<Record<string, string>>; allow: Readonly<Record<string, readonly string[]>> };
/** The rule's options: the tags sync writes, or none. */
export type TagsOptions = [Tags?];

/** What a rule's `meta.schema` takes. */
type RuleSchema = RepoRule["meta"]["schema"];

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

/** No package tagged: what the rule judges by when sync wrote no options. */
const UNTAGGED: Tags = { allow: {}, tags: {} };

/** The tags in the rule's first option, which the schema has shaped; none when sync wrote no options. */
export function tagsOf(options: Readonly<TagsOptions>): Tags {
  return options[0] ?? UNTAGGED;
}

/** `tag` with its article: "a ui", "an app". */
function articled(tag: string): string {
  return `${AN_TAG.test(tag) ? "an" : "a"} ${tag}`;
}

/** `lib`, `app or lib`, `app, ui or lib`. */
function listOf(names: readonly string[]): string {
  return new Intl.ListFormat(LIST_LOCALE, { type: "disjunction" }).format(names);
}

/** The message for a package import the importer's tag may not make, filled by `tagProblem`'s data. */
export const TAG_MESSAGE: string =
  '"{{to}}" is {{targetKind}} package, and {{ownKind}} package may import only {{may}}; ' +
  'move what it needs into a package {{own}} may import, or add "{{target}}" to lint.boundaries.allow.{{own}} ' +
  `in ${CONFIG_FILE}`;

/**
 * The data `TAG_MESSAGE` takes for why the package `from` may not import the package `to`, or null when it may: an
 * untagged (or nameless) side is not judged, and a tag may import its own tag and the ones `allow` lists for it.
 */
export function tagProblem({ tags, allow }: Tags, from: string | null, to: string): Record<string, string> | null {
  const own = from === null ? undefined : tags[from];
  const target = tags[to];
  if (own === undefined || target === undefined || own === target) return null;
  const allowed = allow[own] ?? [];
  if (allowed.includes(target)) return null;
  const may = listOf([own, ...allowed.filter((tag) => tag !== own)]);
  return { may, own, ownKind: articled(own), target, targetKind: articled(target), to };
}
