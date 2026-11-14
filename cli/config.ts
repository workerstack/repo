import fs from "node:fs";
import path from "node:path";

import type { z } from "zod";

import { ciOf } from "./ci-schema.ts";
import { DEFAULT_MAX_CHANGED_LINES } from "./commit-config.ts";
import type { ResolvedCommit, ResolvedConfig, LoadResult } from "./config-resolved.types.ts";
import { configSchema, DEFAULT_PACKS, NO_AGENTS, type Pack, type SkillPack, SKILL_PACKS } from "./config-schema.ts";
import { CONFIG_FILE } from "./config.constants.ts";
import { coverageOf } from "./coverage-config.ts";
import { type ConfigModule, importConfig, type ImportConfig } from "./import-config.ts";
import { lintOf } from "./lint-schema.ts";
import { nightlyOf } from "./nightly-config.ts";
import type { DefaultPack, RepoConfig } from "./repo-config.types.ts";
import { oldConfigHint } from "./sync/migrate-config-name.ts";
import { turboOf } from "./turbo-config.ts";
import { DEFAULT_WORKFLOW } from "./workflow.ts";

export { DEFAULT_MAX_CHANGED_LINES };

export { CONFIG_FILE } from "./config.constants.ts";

export { HOSTS, PACKS, SKILL_PACKS } from "./config-schema.ts";

export type { Host, Pack, SkillPack } from "./config-schema.ts";

export type { ConfigModule, ImportConfig } from "./import-config.ts";

/** The package a config imports `defineConfig` from, and the import error that says nothing provides it. */
const SELF = "@workerstack/repo";
const MISSING_SELF = /Cannot find (?:package|module) '@workerstack\/repo'/;

/** Stock skills gated by a config pack: on only while the pack is in `packs`. */
export const PACK_SKILLS: Readonly<Partial<Record<Pack, readonly string[]>>> = { benchmark: ["benchmark"] };

/** The stock skill names a config turns off: skill packs not in `agents.skills`, and skills of a pack that is off. */
export function offSkills(config: Pick<ResolvedConfig, "agents" | "packs">): string[] {
  const packSkills = Object.entries(PACK_SKILLS)
    .filter(([pack]) => !config.packs.some((on) => on === pack))
    .flatMap(([, names]) => names);

  return [...SKILL_PACKS.filter((pack) => !config.agents.skills.includes(pack)), ...packSkills];
}

export type { RepoConfig };

export type {
  AgentsConfig,
  CiConfig,
  CleanConfig,
  CommitConfig,
  CoverageConfig,
  KnipConfig,
  KnipIgnoreEntry,
  LintConfig,
  LintSkipEntry,
  NightlyConfig,
  OwnerConfig,
  TurboConfig,
} from "./config-sections.types.ts";

export type {
  LintBoundaries,
  LintSkip,
  LoadResult,
  ResolvedAgents,
  ResolvedCommit,
  ResolvedConfig,
  ResolvedLint,
} from "./config-resolved.types.ts";

/** The commit rules a config gets when it omits `commit`. */
export const DEFAULT_COMMIT: ResolvedCommit = { maxChangedLines: DEFAULT_MAX_CHANGED_LINES };

/**
 * Types the default export of repo.config.ts, so the editor completes every key and shows what it does. Hover a key
 * for its values, default and an example. A section whose pack is off in `packs` is an error here.
 *
 * - `packs`: the feature packs to turn on
 * - `agents`: what agents get, and how a session runs by default (agents pack)
 * - `commit`: the commit size limit (standards pack)
 * - `tdd`: test-first for private packages too (standards pack)
 * - `lint`: lint exceptions, package layers, the Tailwind sheet (standards pack)
 * - `knip`: what the unused-code check may skip (standards pack)
 * - `coverage`: the ratchet files and what mutation testing changes
 * - `nightly`: the nightly run's shards and secrets (release pack)
 * - `turbo`: extra turbo tasks (workspace pack)
 * - `workflow`: how changes reach the default branch
 * - `owner`: who public packages name as author
 * - `ci`: extra commands `bun repo ci` runs
 * - `clean`: extra folders `bun repo clean --build` removes
 * - `link`: local checkouts `bun repo link` packs from
 *
 * @example
 * ```ts
 * import { defineConfig } from "@workerstack/repo";
 *
 * export default defineConfig({
 *   packs: ["agents", "standards", "docs", "release"],
 *   nightly: { shards: 4 },
 *   ci: { checks: { e2e: ["bun", "run", "test:e2e"] } },
 * });
 * ```
 */
export function defineConfig<const P extends Pack = DefaultPack>(config: RepoConfig<P>): RepoConfig<P> {
  return config;
}

/** The packs a repo gets when its config omits `packs`. */
export function defaultPacks(): Pack[] {
  return [...DEFAULT_PACKS];
}

/** The nearest directory at or above `cwd` that holds repo.config.ts, or null. */
export function findRoot(cwd: string): string | null {
  let dir = path.resolve(cwd);

  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_FILE))) return dir;
    const parent = path.dirname(dir);

    if (parent === dir) return null;
    dir = parent;
  }
}

/** What a command prints when no config is at or above `cwd`: the move to make when the old name is there. */
export function missingConfig(cwd: string): string {
  return oldConfigHint(cwd) ?? `no ${CONFIG_FILE} in ${cwd} or any parent; run \`bun repo init\``;
}

function fail(messages: string[]): LoadResult {
  return { errors: messages.map((message) => `${CONFIG_FILE}: ${message}`), ok: false };
}

/**
 * Imports and validates `<root>/repo.config.ts`, filling omitted packs from `defaultPacks`, omitted agents with
 * every host and no skills, an omitted commit limit with the default, and omitted lint skips with none.
 */
export async function loadConfig(root: string, importModule: ImportConfig = importConfig): Promise<LoadResult> {
  let loaded: ConfigModule;

  try {
    loaded = await importModule(root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // A linked worktree without its own install fails here; the fix is an install, not an edit to the config.
    if (MISSING_SELF.test(message)) return fail([`${SELF} is not installed in ${root}; run \`bun install\` there`]);

    return fail([`failed to load: ${message}`]);
  }

  if (!("default" in loaded)) return fail(["no default export; add `export default defineConfig({ ... })`"]);

  const parsed = configSchema.safeParse(loaded.default);

  if (!parsed.success) return fail(parsed.error.issues.flatMap(describeIssue));

  return { config: resolve(parsed.data), ok: true };
}

/** A parsed config with every omitted value filled in. */
function resolve(d: z.output<typeof configSchema>): ResolvedConfig {
  return {
    agents: d.agents ?? NO_AGENTS,
    clean: d.clean,
    commit: { maxChangedLines: d.commit?.maxChangedLines ?? DEFAULT_COMMIT.maxChangedLines },
    knip: { ignore: d.knip?.ignore ?? [] },
    link: d.link,
    lint: lintOf(d.lint),
    owner: d.owner,
    packs: d.packs ?? defaultPacks(),
    tdd: d.tdd ?? false,
    turbo: turboOf(d.turbo),
    workflow: d.workflow ?? DEFAULT_WORKFLOW,
    ...ciOf(d),
    ...coverageOf(d),
    ...nightlyOf(d),
  };
}

/**
 * The skill packs `agents.skills` enables for the repo at or above `cwd`; none when there is no config or it is
 * invalid.
 */
export async function enabledSkills(cwd: string): Promise<readonly SkillPack[]> {
  const root = findRoot(cwd);

  if (root === null) return [];
  const loaded = await loadConfig(root);

  return loaded.ok ? loaded.config.agents.skills : [];
}

/** The dot a config path starts with once its keys are joined. */
const LEADING_DOT = /^\./;

/** True for an array index in a zod issue path, false for an object key. */
function isIndex(key: PropertyKey): key is number {
  return typeof key === "number";
}

/** Config paths whose old key was renamed, with the text that says so; the old key is refused, never read. */
const RENAMED_KEYS: ReadonlyMap<string, string> = /* @__PURE__ */ new Map([
  ["agents.defaultMode", "agents.defaultMode is now agents.defaultApproval; run bun repo sync"],
]);

function describeIssue(issue: z.core.$ZodIssue): string[] {
  // ["packs", 1] reads packs[1]; a config path always starts at a top-level key.
  const at = issue.path
    .map((key) => (isIndex(key) ? `[${key}]` : `.${String(key)}`))
    .join("")
    .replace(LEADING_DOT, "");

  const prefix = at === "" ? "" : `${at}: `;

  if (issue.code === "unrecognized_keys")
    return issue.keys.map((key) => RENAMED_KEYS.get(`${at}.${key}`) ?? `${prefix}unknown key ${JSON.stringify(key)}`);

  return [`${prefix}${issue.message}`];
}
