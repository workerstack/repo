/**
 * Frontmatter is user input, so it is checked here, once: a rule needs a `description` and may carry `paths` (a list
 * of strings); `overrides` is a string; a subagent's `variants` is a list of mappings, each with a `name`.
 */
import type { ParsedDoc } from "./frontmatter.ts";
import { MAX_BODY_BYTES, RULE_KEYS, RULES, SUBAGENT_BASE_KEYS } from "./sources.constants.ts";
import type { Kind } from "./sources.types.ts";
import { TARGET } from "./subagents.ts";
import { isVariantList } from "./variants.ts";

/** The keys a doc of `kind` may carry. */
function keysOf(kind: Kind): readonly string[] {
  return kind === RULES ? RULE_KEYS : [...SUBAGENT_BASE_KEYS, ...Object.values(TARGET)];
}

/** What is wrong with a rule's own keys, or null. */
function ruleProblem(data: ParsedDoc["data"]): string | null {
  const description = data["description"];
  if (typeof description !== "string" || description.trim() === "")
    return "invalid frontmatter: description is required";
  const paths = data["paths"];
  if (paths !== undefined && !(Array.isArray(paths) && paths.every((glob) => typeof glob === "string")))
    return "invalid frontmatter: paths must be a list of strings";
  return null;
}

/** What is wrong with a body: empty, or over the size limit. */
function bodyProblem(body: string): string | null {
  if (body.trim() === "") return "body is empty; write the instructions below the frontmatter";
  const bytes = Buffer.byteLength(body);
  if (bytes <= MAX_BODY_BYTES) return null;
  return (
    `body is ${bytes} bytes, over the 8 KiB (${MAX_BODY_BYTES} byte) limit; ` +
    "move detail into a skill or a reference"
  );
}

/** What is wrong with `parsed`, or null: unknown keys, bad value types, an empty or oversized body. */
export function frontmatterProblem(kind: Kind, { data, body }: ParsedDoc): string | null {
  const keys = keysOf(kind);
  const unknown = Object.keys(data).find((key) => !keys.includes(key));
  if (unknown !== undefined) return `unknown frontmatter key "${unknown}"; use ${keys.join(", ")}`;
  if (data["overrides"] !== undefined && typeof data["overrides"] !== "string")
    return "invalid frontmatter: overrides must be a string";
  if (data["variants"] !== undefined && !isVariantList(data["variants"]))
    return "invalid frontmatter: variants must be a list of mappings, each with a name";
  const bad = kind === RULES ? ruleProblem(data) : null;
  return bad ?? bodyProblem(body);
}
