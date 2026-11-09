import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { coverageOf, coverageSchema, type ResolvedCoverage } from "./coverage-config.ts";
import { knipSchema, type ResolvedKnip } from "./knip-schema.ts";
import { lintSchema } from "./lint-schema.ts";
import type { WorkerstackConfig } from "./workerstack-config.types.ts";

/** Config packs a repo can turn on in workerstack.config.ts. */
export const PACKS = ["agents", "standards", "docs"] as const;
export type Pack = (typeof PACKS)[number];

export const CONFIG_FILE = "workerstack.config.ts";

/** The package a config imports `defineConfig` from, and the import error that says nothing provides it. */
const SELF = "@workerstack/repo";
const MISSING_SELF = /Cannot find (?:package|module) '@workerstack\/repo'/;

/** Agent hosts repo sync can lay a tree out for. */
export const HOSTS = ["claude", "codex", "antigravity", "grok", "cursor"] as const;
export type Host = (typeof HOSTS)[number];

/** Optional skill packs a repo can ship to its agents. */
export const SKILL_PACKS = ["google-workspace", "listen", "speak", "clasp"] as const;
export type SkillPack = (typeof SKILL_PACKS)[number];

const listOf = (names: readonly string[]) => `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;

const packSchema = z.enum(PACKS, {
  error: (issue) => `${JSON.stringify(issue.input)} is not a pack; use ${listOf(PACKS)}`,
});
const hostSchema = z.enum(HOSTS, {
  error: (issue) => `${JSON.stringify(issue.input)} is not a host; use ${listOf(HOSTS)}`,
});
const skillSchema = z.enum(SKILL_PACKS, {
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
        const times = count === 2 ? "twice" : `${count} times`;
        ctx.addIssue({ code: "custom", message: `${JSON.stringify(name)} is listed ${times}` });
      }
    });
}

const agentsSchema = z.strictObject(
  {
    hosts: uniqueList(hostSchema, "must be a list of host names")
      .refine((hosts) => hosts.length > 0, { error: "list at least one host" })
      .optional(),
    skills: uniqueList(skillSchema, "must be a list of skill pack names").optional(),
  },
  { error: "must be an object like { hosts: [...], skills: [...] }" },
);

/** How many changed lines a commit may have before its message must say why. */
export const DEFAULT_MAX_CHANGED_LINES = 1000;

const commitSchema = z.strictObject(
  {
    maxChangedLines: z
      .number({ error: "must be a whole number of lines above 0" })
      .int({ error: "must be a whole number of lines above 0" })
      .positive({ error: "must be a whole number of lines above 0" })
      .optional(),
  },
  { error: `must be an object like { maxChangedLines: ${DEFAULT_MAX_CHANGED_LINES} }` },
);

/** A config section that only means something with its pack on. */
const needsPack = (key: "agents" | "commit" | "knip" | "lint" | "tdd", pack: Pack) => ({
  path: [key],
  error: `set only with the ${pack} pack; add "${pack}" to packs or delete ${key}`,
});

/** Whether the config turns `pack` on, by its `packs` or the default ones. */
const hasPack = (config: { packs?: readonly Pack[] | undefined }, pack: Pack) =>
  (config.packs ?? defaultPacks()).includes(pack);

const configSchema = z
  .strictObject(
    {
      packs: uniqueList(packSchema, "must be a list of pack names").optional(),
      agents: agentsSchema.optional(),
      commit: commitSchema.optional(),
      lint: lintSchema().optional(),
      knip: knipSchema().optional(),
      coverage: coverageSchema.optional(),
      tdd: z.boolean({ error: "must be true or false" }).optional(),
    },
    { error: "the default export must be an object; use `export default defineConfig({ ... })`" },
  )
  .refine((config) => config.agents === undefined || hasPack(config, "agents"), needsPack("agents", "agents"))
  .refine((config) => config.commit === undefined || hasPack(config, "standards"), needsPack("commit", "standards"))
  .refine((config) => config.lint === undefined || hasPack(config, "standards"), needsPack("lint", "standards"))
  .refine((config) => config.knip === undefined || hasPack(config, "standards"), needsPack("knip", "standards"))
  .refine(
    (config) => config.tdd === undefined || hasPack(config, "standards"),
    needsPack("tdd", "standards"),
  ) satisfies z.ZodType<unknown, WorkerstackConfig>;

export type { WorkerstackConfig };
export type ResolvedAgents = { readonly hosts: readonly Host[]; readonly skills: readonly SkillPack[] };
/** What the commit-msg hook checks a commit against. */
export type ResolvedCommit = { readonly maxChangedLines: number };
/** One `lint.skip` entry: the rules (oxlint keys) it turns off, for the files its globs match, and why. */
export type LintSkip = { files: readonly string[]; rules: readonly string[]; reason: string };
/** What the generated oxlint config and `repo check` read from `lint`. */
export type ResolvedLint = { readonly skip: readonly LintSkip[] };
export type ResolvedConfig = {
  readonly packs: readonly Pack[];
  readonly agents: ResolvedAgents;
  readonly commit: ResolvedCommit;
  readonly lint: ResolvedLint;
  readonly knip: ResolvedKnip;
  readonly coverage: ResolvedCoverage;
  /** Whether a feat or fix in a private package must also fail its tests on HEAD's source; public packages always do. */
  readonly tdd: boolean;
};
/** The commit rules a config gets when it omits `commit`. */
export const DEFAULT_COMMIT: ResolvedCommit = { maxChangedLines: DEFAULT_MAX_CHANGED_LINES };
export type LoadResult = { ok: true; config: ResolvedConfig } | { ok: false; errors: string[] };

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
    ok: false,
    errors: messages.map((message) => `${CONFIG_FILE}: ${message}`),
  });

  let loaded: Record<string, unknown>;
  try {
    loaded = await importModule(root);
  } catch (error) {
    const message = messageOf(error);
    // A linked worktree without its own install fails here; the fix is an install, not an edit to the config.
    if (MISSING_SELF.test(message)) return fail([`${SELF} is not installed in ${root}; run \`bun install\` there`]);
    return fail([`failed to load: ${message}`]);
  }
  if (!("default" in loaded)) return fail(["no default export; add `export default defineConfig({ ... })`"]);

  const parsed = configSchema.safeParse(loaded.default);
  if (!parsed.success) return fail(parsed.error.issues.flatMap(describeIssue));
  return { ok: true, config: resolve(parsed.data) };
}

/** The agent hosts and skills a config turns on; every host and no skills when omitted. */
function agentsOf(agents: z.output<typeof agentsSchema> | undefined): ResolvedAgents {
  return { hosts: agents?.hosts ?? HOSTS, skills: agents?.skills ?? [] };
}

/** A parsed config with every omitted value filled in. */
function resolve(d: z.output<typeof configSchema>): ResolvedConfig {
  const agents = agentsOf(d.agents);
  const commit = { maxChangedLines: d.commit?.maxChangedLines ?? DEFAULT_COMMIT.maxChangedLines };
  return {
    packs: d.packs ?? defaultPacks(),
    agents,
    commit,
    lint: { skip: d.lint?.skip ?? [] },
    knip: { ignore: d.knip?.ignore ?? [] },
    tdd: d.tdd ?? false,
    ...coverageOf(d),
  };
}

/** Imports the config module of `root`; `loadConfig` takes another in tests, whose runner resolves packages its own way. */
export type ImportConfig = (root: string) => Promise<Record<string, unknown>>;

/** Each config file's last loaded text and module, so a load can tell whether the text on disk changed. */
const loadedConfigs = new Map<string, { text: string; module: Record<string, unknown> }>();

/**
 * The config module. A module is cached by path for the life of the process (a query string does not bust that
 * cache), so a file whose text changed since it was loaded is imported from a temporary copy beside it (same
 * imports resolve, new path). A first load, or an unchanged file, writes nothing.
 */
async function importConfig(root: string): Promise<Record<string, unknown>> {
  const file = path.join(root, CONFIG_FILE);
  const text = fs.readFileSync(file, "utf8");
  const known = loadedConfigs.get(file);
  if (known?.text === text) return known.module;
  let module: Record<string, unknown>;
  if (known === undefined) {
    module = await import(/* @vite-ignore */ pathToFileURL(file).href);
  } else {
    const copy = path.join(root, `.workerstack.config.${randomBytes(6).toString("hex")}.ts`);
    fs.copyFileSync(file, copy);
    try {
      module = await import(/* @vite-ignore */ pathToFileURL(copy).href);
    } finally {
      fs.rmSync(copy, { force: true });
    }
  }
  loadedConfigs.set(file, { text, module });
  return module;
}

/** The skill packs `agents.skills` enables for the repo at or above `cwd`; none when there is no config or it is invalid. */
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
