/**
 * Rule outputs: `AGENTS.md` for every host, `.agents/rules/` for antigravity and `.grok/rules/` for grok.
 * A rule's `targets` (default `["*"]`) pick where it goes. `agentsmd` folds into AGENTS.md directly, where
 * rulesync emitted nothing for it.
 */
import type { Host } from "../../config.ts";
import { emitYaml, finalize, type YamlValue } from "./frontmatter.ts";
import type { Doc, Sources } from "./sources.ts";

/** Targets whose rules fold into AGENTS.md; a root rule for grok or antigravity lands there too. */
const AGENTSMD_TARGETS = ["agentsmd", "codexcli"];
const ROOT_TARGETS = [...AGENTSMD_TARGETS, "grokcli", "antigravity-cli"];

function targeted(doc: Doc, targets: readonly string[]): boolean {
  const own = doc.data.targets;
  if (!Array.isArray(own)) return true;
  return own.includes("*") || targets.some((target) => own.includes(target));
}

const isRoot = (doc: Doc) => doc.data.root === true;

/** POSIX path to file text for the rules of `sources`, given the hosts that are on. */
export function renderRules(sources: Sources, hosts: readonly Host[]): Map<string, string> {
  const out = new Map<string, string>();
  if (hosts.length === 0) return out;

  const roots = sources.rules.filter((doc) => isRoot(doc) && targeted(doc, ROOT_TARGETS));
  const nonRoots = sources.rules.filter((doc) => !isRoot(doc));
  const folded = [...roots, ...nonRoots.filter((doc) => targeted(doc, AGENTSMD_TARGETS))];
  const agents = folded.map((doc) => doc.body.trim()).filter((body) => body !== "");
  out.set("AGENTS.md", finalize(agents.join("\n\n")));

  if (hosts.includes("antigravity")) {
    for (const doc of nonRoots.filter((d) => targeted(d, ["antigravity-cli"]))) {
      out.set(`.agents/rules/${doc.file}`, finalize(`---\n${emitYaml(Object.entries(antigravityFrontmatter(doc)))}---\n${doc.body}`));
    }
  }
  if (hosts.includes("grok")) {
    for (const doc of nonRoots.filter((d) => targeted(d, ["grokcli"]))) out.set(`.grok/rules/${doc.file}`, finalize(doc.body));
  }
  return out;
}

const globList = (globs: unknown): string[] =>
  Array.isArray(globs)
    ? globs.map(String)
    : typeof globs === "string" && globs.trim() !== ""
      ? globs.split(",").map((g) => g.trim())
      : [];

const joinGlobs = (globs: string[]) => (globs.length === 0 ? undefined : globs.join(","));

/**
 * The `trigger:` frontmatter rulesync's antigravity strategies wrote: an `antigravity:` block's trigger first,
 * else `glob` when the rule's globs are set and hold neither `**\/*` nor `*`, else `always_on`.
 */
function antigravityFrontmatter(doc: Doc): Record<string, YamlValue> {
  const block = doc.data.antigravity;
  const stored =
    typeof block === "object" && block !== null && !Array.isArray(block)
      ? (block as Record<string, YamlValue>)
      : undefined;
  let normalized: Record<string, YamlValue> = {};
  if (stored !== undefined) {
    const { globs, ...rest } = stored;
    normalized = { ...rest, globs: Array.isArray(globs) ? joinGlobs(globs.map(String)) : globs };
  }
  const effectiveGlobs = () => (normalized.globs ? globList(normalized.globs) : globList(doc.data.globs));
  const trigger = stored?.trigger;
  switch (trigger) {
    case "glob":
      return { ...normalized, trigger: "glob", globs: joinGlobs(effectiveGlobs()) };
    case "manual":
    case "always_on":
      return { ...normalized, trigger };
    case "model_decision":
      return { ...normalized, trigger, description: doc.data.description as YamlValue };
    case undefined: {
      const globs = effectiveGlobs();
      if (globs.length > 0 && !globs.includes("**/*") && !globs.includes("*")) {
        return { ...normalized, trigger: "glob", globs: joinGlobs(globs) };
      }
      return { ...normalized, trigger: "always_on" };
    }
    default:
      return { ...normalized, trigger: typeof trigger === "string" ? trigger : "manual" };
  }
}
