import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

/** Config packs a repo can turn on in workerstack.config.ts. */
export const PACKS = ["agents", "standards", "docs"] as const;
export type Pack = (typeof PACKS)[number];

export const CONFIG_FILE = "workerstack.config.ts";

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

export const configSchema = z
  .strictObject(
    {
      packs: uniqueList(packSchema, "must be a list of pack names").optional(),
      agents: agentsSchema.optional(),
    },
    { error: "the default export must be an object; use `export default defineConfig({ ... })`" },
  )
  .refine((config) => config.agents === undefined || (config.packs ?? defaultPacks()).includes("agents"), {
    path: ["agents"],
    error: 'set only with the agents pack; add "agents" to packs or delete agents',
  });

export type WorkerstackConfig = z.input<typeof configSchema>;
export type ResolvedAgents = { readonly hosts: readonly Host[]; readonly skills: readonly SkillPack[] };
export type ResolvedConfig = { readonly packs: readonly Pack[]; readonly agents: ResolvedAgents };
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

/** Imports and validates `<root>/workerstack.config.ts`, filling omitted packs from `defaultPacks` and omitted agents with every host and no skills. */
export async function loadConfig(root: string): Promise<LoadResult> {
  const fail = (messages: string[]): LoadResult => ({
    ok: false,
    errors: messages.map((message) => `${CONFIG_FILE}: ${message}`),
  });

  let loaded: Record<string, unknown>;
  try {
    loaded = await importConfig(root);
  } catch (error) {
    return fail([`failed to load: ${messageOf(error)}`]);
  }
  if (!("default" in loaded)) return fail(["no default export; add `export default defineConfig({ ... })`"]);

  const parsed = configSchema.safeParse(loaded.default);
  if (!parsed.success) return fail(parsed.error.issues.flatMap(describeIssue));
  const agents: ResolvedAgents = {
    hosts: parsed.data.agents?.hosts ?? HOSTS,
    skills: parsed.data.agents?.skills ?? [],
  };
  const packs = parsed.data.packs ?? defaultPacks();
  return { ok: true, config: { packs, agents } };
}

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
