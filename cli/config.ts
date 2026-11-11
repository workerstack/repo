import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { ciOf, ciSchema } from "./ci-schema.ts";
import { cleanSchema } from "./clean-schema.ts";
import { commitSchema, DEFAULT_MAX_CHANGED_LINES } from "./commit-config.ts";
import type { ResolvedAgents, ResolvedCommit, ResolvedConfig, LoadResult } from "./config-resolved.types.ts";
import { CONFIG_FILE, LAST, TWICE } from "./config.constants.ts";
import { coverageOf, coverageSchema } from "./coverage-config.ts";
import { importConfig, type ImportConfig } from "./import-config.ts";
import { knipSchema } from "./knip-schema.ts";
import { linkSchema } from "./link-schema.ts";
import { lintOf, lintSchema } from "./lint-schema.ts";
import { nightlyOf, nightlySchema } from "./nightly-config.ts";
import { ownerSchema } from "./owner-config.ts";
import { generatedTask } from "./turbo-config.constants.ts";
import { generatedNames, turboOf, turboSchema } from "./turbo-config.ts";
import type { WorkerstackConfig } from "./workerstack-config.types.ts";

export { DEFAULT_MAX_CHANGED_LINES };
export { CONFIG_FILE } from "./config.constants.ts";
export type { ImportConfig } from "./import-config.ts";

/** Config packs a repo can turn on in workerstack.config.ts. */
export const PACKS = ["agents", "standards", "docs", "release", "workspace"] as const;
/** One of `PACKS`: the name `packs` in workerstack.config.ts takes. */
export type Pack = (typeof PACKS)[number];

/** The package a config imports `defineConfig` from, and the import error that says nothing provides it. */
const SELF = "@workerstack/repo";
const MISSING_SELF = /Cannot find (?:package|module) '@workerstack\/repo'/;

/** Agent hosts repo sync can lay a tree out for. */
export const HOSTS = ["claude", "codex", "antigravity", "grok", "cursor"] as const;
/** One of `HOSTS`: a name `agents.hosts` takes. */
export type Host = (typeof HOSTS)[number];

/** Optional skill packs a repo can ship to its agents. */
export const SKILL_PACKS = ["google-workspace", "listen", "speak", "clasp"] as const;
/** One of `SKILL_PACKS`: a name `agents.skills` takes. */
export type SkillPack = (typeof SKILL_PACKS)[number];

const listOf = (names: readonly string[]) => `${names.slice(0, LAST).join(", ")} or ${names.at(LAST)}`;

const packSchema = /* @__PURE__ */ z.enum(PACKS, {
  error: (issue) => `${JSON.stringify(issue.input)} is not a pack; use ${listOf(PACKS)}`,
});
const hostSchema = /* @__PURE__ */ z.enum(HOSTS, {
  error: (issue) => `${JSON.stringify(issue.input)} is not a host; use ${listOf(HOSTS)}`,
});
const skillSchema = /* @__PURE__ */ z.enum(SKILL_PACKS, {
  error: (issue) => `${JSON.stringify(issue.input)} is not a skill pack; use ${listOf(SKILL_PACKS)}`,
});

/** A list of unique names; a repeat is reported with its count. */
function uniqueList<S extends z.ZodType<string>>(item: S, error: string) {
  return z
    .array(item, { error })
    .readonly()
    .superRefine((names, ctx) => {
      const counts = new Map<z.output<S>, number>();
      for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
      for (const [name, count] of counts) {
        if (count === 1) continue;
        const times = count === TWICE ? "twice" : `${count} times`;
        ctx.addIssue({ code: "custom", message: `${JSON.stringify(name)} is listed ${times}` });
      }
    });
}

function buildAgentsSchema() {
  return z.strictObject(
    {
      hosts: uniqueList(hostSchema, "must be a list of host names")
        .refine((hosts) => hosts.length > 0, { error: "list at least one host" })
        .optional(),
      skills: uniqueList(skillSchema, "must be a list of skill pack names").optional(),
    },
    { error: "must be an object like { hosts: [...], skills: [...] }" },
  );
}
const agentsSchema = /* @__PURE__ */ buildAgentsSchema();

/** A config section that only means something with its pack on. */
const needsPack = (key: "agents" | "commit" | "knip" | "lint" | "nightly" | "tdd" | "turbo", pack: Pack) => ({
  error: `set only with the ${pack} pack; add "${pack}" to packs or delete ${key}`,
  path: [key],
});

/** Whether the config turns `pack` on, by its `packs` or the default ones. */
const hasPack = (config: { packs?: readonly Pack[] | undefined }, pack: Pack) =>
  (config.packs ?? defaultPacks()).includes(pack);

/** The sections a config's default export may hold, each parsed on its own. */
function configShape() {
  return z.strictObject(
    {
      agents: agentsSchema.optional(),
      ci: ciSchema().optional(),
      clean: cleanSchema().optional(),
      commit: commitSchema().optional(),
      coverage: coverageSchema.optional(),
      knip: knipSchema().optional(),
      link: linkSchema().optional(),
      lint: lintSchema().optional(),
      nightly: nightlySchema.optional(),
      owner: ownerSchema().optional(),
      packs: uniqueList(packSchema, "must be a list of pack names").optional(),
      tdd: z.boolean({ error: "must be true or false" }).optional(),
      turbo: turboSchema.optional(),
    },
    { error: "the default export must be an object; use `export default defineConfig({ ... })`" },
  );
}

/** The schema of a config's default export, each section checked against the packs it needs. */
function buildConfigSchema() {
  return configShape()
    .refine((config) => config.agents === undefined || hasPack(config, "agents"), needsPack("agents", "agents"))
    .refine((config) => config.commit === undefined || hasPack(config, "standards"), needsPack("commit", "standards"))
    .refine((config) => config.lint === undefined || hasPack(config, "standards"), needsPack("lint", "standards"))
    .refine((config) => config.knip === undefined || hasPack(config, "standards"), needsPack("knip", "standards"))
    .refine((config) => config.nightly === undefined || hasPack(config, "release"), needsPack("nightly", "release"))
    .refine((config) => config.turbo === undefined || hasPack(config, "workspace"), needsPack("turbo", "workspace"))
    .superRefine((config, ctx) => {
      for (const name of generatedNames(config.turbo)) ctx.addIssue({ code: "custom", message: generatedTask(name) });
    })
    .refine(
      (config) => config.tdd === undefined || hasPack(config, "standards"),
      needsPack("tdd", "standards"),
    ) satisfies z.ZodType<unknown, WorkerstackConfig>;
}
const configSchema = /* @__PURE__ */ buildConfigSchema();

export type { WorkerstackConfig };
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

/** Types a workerstack.config.ts default export. */
export function defineConfig(config: WorkerstackConfig): WorkerstackConfig {
  return config;
}

/** The packs a repo gets when its config omits `packs`. */
export function defaultPacks(): Pack[] {
  return ["agents", "standards", "docs"];
}

/** The nearest directory at or above `cwd` that holds workerstack.config.ts, or null. */
export function findRoot(cwd: string): string | null {
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_FILE))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Imports and validates `<root>/workerstack.config.ts`, filling omitted packs from `defaultPacks`, omitted agents with
 * every host and no skills, an omitted commit limit with the default, and omitted lint skips with none.
 */
export async function loadConfig(root: string, importModule: ImportConfig = importConfig): Promise<LoadResult> {
  const fail = (messages: string[]): LoadResult => ({
    errors: messages.map((message) => `${CONFIG_FILE}: ${message}`),
    ok: false,
  });

  let loaded: Record<string, unknown>;
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

/** The agent hosts and skills a config turns on; every host and no skills when omitted. */
function agentsOf(agents: z.output<typeof agentsSchema> | undefined): ResolvedAgents {
  return { hosts: agents?.hosts ?? HOSTS, skills: agents?.skills ?? [] };
}

/** A parsed config with every omitted value filled in. */
function resolve(d: z.output<typeof configSchema>): ResolvedConfig {
  return {
    agents: agentsOf(d.agents),
    clean: d.clean,
    commit: { maxChangedLines: d.commit?.maxChangedLines ?? DEFAULT_COMMIT.maxChangedLines },
    knip: { ignore: d.knip?.ignore ?? [] },
    link: d.link,
    lint: lintOf(d.lint),
    owner: d.owner,
    packs: d.packs ?? defaultPacks(),
    tdd: d.tdd ?? false,
    turbo: turboOf(d.turbo),
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

function describeIssue(issue: z.core.$ZodIssue): string[] {
  // ["packs", 1] reads packs[1]; a config path always starts at a top-level key.
  const at = issue.path
    .map((key) => (typeof key === "number" ? `[${key}]` : `.${String(key)}`))
    .join("")
    .replace(/^\./, "");
  const prefix = at ? `${at}: ` : "";
  if (issue.code === "unrecognized_keys") return issue.keys.map((key) => `${prefix}unknown key ${JSON.stringify(key)}`);
  return [`${prefix}${issue.message}`];
}
