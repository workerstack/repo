// Repos, rules and a checker for the `.repo/` suites: every check runs against this repo's own stock.
import { AGENT_DEFAULTS } from "../../agent-defaults.constants.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { offSkills, type Pack, type SkillPack } from "../../config.ts";
import type { Doc, Sources } from "../agents/sources.types.ts";
import { repoDirProblems } from "../repo-dir.ts";
import { put, tempDir } from "./temp-dirs.ts";

/** Past the 12 KiB the always-on budget once capped pathless rules at. */
export const BIG_RULE_BYTES = 13_000;
/** The workspace package the package suites put a `.repo/` in. */
export const WEB = "packages/web";
const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** A temp repo holding `files`, root-relative path to text. */
export function repo(files: Readonly<Record<string, string>> = {}): string {
  const root = tempDir("workerstack-repo-dir-");
  for (const [rel, text] of Object.entries(files)) put(root, rel, text);
  return root;
}

/** A rule as `scope`'s `.repo/rules/<name>.md` holds it, with `paths` when given and any more frontmatter `data`. */
function ruleIn(scope: string, name: string, more: { body: string; paths?: string[]; data?: Record<string, unknown> }) {
  const { body, paths, data } = more;
  const doc: Doc = {
    body,
    data: { description: "d", ...(paths === undefined ? {} : { paths }), ...data },
    file: `${name}.md`,
    origin: "repo",
    rel: `${scope === "" ? "" : `${scope}/`}.repo/rules/${name}.md`,
    scope,
  };
  return doc;
}

/** A root `.repo/rules/<name>.md` rule. */
export function rule(name: string, body: string, paths?: string[]): Doc {
  return ruleIn("", name, { body, paths });
}

/** A rule of the `WEB` package. */
export function pkgRule(name: string, body: string, more: { paths?: string[]; data?: Record<string, unknown> } = {}): Doc {
  return ruleIn(WEB, name, { body, ...more });
}

/** Sources holding only `rules`. */
export function sourcesOf(rules: Doc[] = []): Sources {
  return { hooks: { rel: "agents/hooks.jsonc", value: {} }, rules, subagents: [] };
}

/** What git lists, the enabled skill packs and the workspace packages of one check; none of each by default. */
export type CheckOptions = { listed?: string[] | null; skills?: readonly SkillPack[]; packs?: readonly Pack[]; packages?: string[] };

/** The `.repo/` problems of `root` with `rules` loaded, against this repo's stock. */
export function check(root: string, rules: Doc[] = [], options: CheckOptions = {}): string[] {
  const { listed = null, packages = [], packs = ["agents"], skills = [] } = options;
  const off = offSkills({ agents: { ...AGENT_DEFAULTS, hosts: [], skills }, packs });
  return repoDirProblems(root, { listed, off, packages, sources: sourcesOf(rules), stock: SELF_ROOT });
}

/** A SKILL.md named `name`. */
export function skill(name: string, description = "does a thing", body = ""): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;
}

/** The problems of a repo of `files` with `rules` loaded and `WEB` a workspace package. */
export function inPkg(rules: Doc[], listed: string[] | null = null, files: Readonly<Record<string, string>> = {}): string[] {
  return check(repo(files), rules, { listed, packages: [WEB] });
}
