/** The schema of a repo.config.ts default export, and the packs, hosts and skill packs its keys take. */
import { z } from "zod";

import { type AgentDefaultKeys, agentDefaultKeys, agentDefaultsExample } from "./agent-defaults-schema.ts";
import { ciSchema } from "./ci-schema.ts";
import { cleanSchema } from "./clean-schema.ts";
import { commitSchema } from "./commit-config.ts";
import type { ResolvedAgents } from "./config-resolved.types.ts";
import { LAST } from "./config.constants.ts";
import { coverageSchema } from "./coverage-config.ts";
import { knipSchema } from "./knip-schema.ts";
import { linkSchema } from "./link-schema.ts";
import { lintSchema } from "./lint-schema.ts";
import { nightlySchema } from "./nightly-config.ts";
import { ownerSchema } from "./owner-config.ts";
import { reportRepeats } from "./report-repeats.ts";
import { generatedTask } from "./turbo-config.constants.ts";
import { generatedNames, turboSchema } from "./turbo-config.ts";
import { workflowSchema } from "./workflow.ts";

/** Config packs a repo can turn on in repo.config.ts. */
export const PACKS = ["agents", "standards", "docs", "release", "workspace", "benchmark", "evals"] as const;

/** One of `PACKS`: the name `packs` in repo.config.ts takes. */
export type Pack = (typeof PACKS)[number];

/** The packs a repo gets when its config omits `packs`. */
export const DEFAULT_PACKS = ["agents", "standards", "docs"] as const;

/** Each config section that means something only with a pack on, and the pack it needs. */
export type SectionPacks = {
  /** `agents` needs the agents pack. */
  readonly agents: "agents";
  /** `commit` needs the standards pack. */
  readonly commit: "standards";
  /** `knip` needs the standards pack. */
  readonly knip: "standards";
  /** `lint` needs the standards pack. */
  readonly lint: "standards";
  /** `nightly` needs the release pack. */
  readonly nightly: "release";
  /** `tdd` needs the standards pack. */
  readonly tdd: "standards";
  /** `turbo` needs the workspace pack. */
  readonly turbo: "workspace";
};

/** `SectionPacks` as a value. */
export const SECTION_PACKS: SectionPacks = {
  agents: "agents",
  commit: "standards",
  knip: "standards",
  lint: "standards",
  nightly: "release",
  tdd: "standards",
  turbo: "workspace",
};

/** Agent hosts repo sync can lay a tree out for. */
export const HOSTS = ["claude", "codex", "antigravity", "grok", "cursor"] as const;

/** One of `HOSTS`: a name `agents.hosts` takes. */
export type Host = (typeof HOSTS)[number];

/** Optional skill packs a repo can ship to its agents. */
export const SKILL_PACKS = ["google-workspace", "listen", "speak", "clasp"] as const;

/** One of `SKILL_PACKS`: a name `agents.skills` takes. */
export type SkillPack = (typeof SKILL_PACKS)[number];

function listOf(names: readonly string[]) {
  return `${names.slice(0, LAST).join(", ")} or ${names.at(LAST)}`;
}

const packSchema = /* @__PURE__ */ z.enum(PACKS, {
  error: (issue) => `${JSON.stringify(issue.input)} is not a pack; use ${listOf(PACKS)}`,
});

const hostSchema = /* @__PURE__ */ z.enum(HOSTS, {
  error: (issue) => `${JSON.stringify(issue.input)} is not a host; use ${listOf(HOSTS)}`,
});

const skillSchema = /* @__PURE__ */ z.enum(SKILL_PACKS, {
  error: (issue) => `${JSON.stringify(issue.input)} is not a skill pack; use ${listOf(SKILL_PACKS)}`,
});

/** A list of names from `N`, as the schema of `packs`, `agents.hosts` or `agents.skills` reads it. */
type NameList<N extends string> = z.ZodReadonly<z.ZodArray<z.ZodEnum<{ [K in N]: K }>>>;

type AgentsSchema = z.ZodObject<
  AgentDefaultKeys & { hosts: z.ZodDefault<NameList<Host>>; skills: z.ZodDefault<NameList<SkillPack>> },
  z.core.$strict
>;

/** A list of unique names; a repeat is reported with its count. */
function uniqueList<N extends string>(item: z.ZodEnum<{ [K in N]: K }>, error: string): NameList<N> {
  return z.array(item, { error }).readonly().superRefine(reportRepeats);
}

function buildAgentsSchema(): AgentsSchema {
  return z.strictObject(
    {
      ...agentDefaultKeys(),
      hosts: uniqueList(hostSchema, "must be a list of host names")
        .refine((hosts) => hosts.length > 0, { error: "list at least one host" })
        .default(HOSTS),
      skills: uniqueList(skillSchema, "must be a list of skill pack names").default([]),
    },
    { error: `must be an object like { hosts: [...], skills: [...], ${agentDefaultsExample()} }` },
  );
}

const agentsSchema = /* @__PURE__ */ buildAgentsSchema();

/** The agents an omitted `agents` key turns on: every host, no skills and each built-in default. */
export const NO_AGENTS: ResolvedAgents = /* @__PURE__ */ agentsSchema.parse({});

/** The refusal of a section set while its pack is off. */
function needsPack(key: string, pack: Pack) {
  return {
    error: `set only with the ${pack} pack; add "${pack}" to packs or delete ${key}`,
    path: [key],
  };
}

/** Whether the config turns `pack` on, by its `packs` or the default ones. */
function hasPack(config: { packs?: readonly Pack[] | undefined }, pack: Pack) {
  return (config.packs ?? DEFAULT_PACKS).some((on) => on === pack);
}

type BaseSchema = z.ZodObject<
  {
    agents: z.ZodOptional<AgentsSchema>;
    ci: z.ZodOptional<ReturnType<typeof ciSchema>>;
    clean: z.ZodOptional<ReturnType<typeof cleanSchema>>;
    commit: z.ZodOptional<ReturnType<typeof commitSchema>>;
    coverage: z.ZodOptional<typeof coverageSchema>;
    knip: z.ZodOptional<ReturnType<typeof knipSchema>>;
    link: z.ZodOptional<ReturnType<typeof linkSchema>>;
    lint: z.ZodOptional<ReturnType<typeof lintSchema>>;
    nightly: z.ZodOptional<typeof nightlySchema>;
    owner: z.ZodOptional<ReturnType<typeof ownerSchema>>;
    packs: z.ZodOptional<NameList<Pack>>;
    tdd: z.ZodOptional<z.ZodBoolean>;
    turbo: z.ZodOptional<typeof turboSchema>;
    workflow: z.ZodOptional<ReturnType<typeof workflowSchema>>;
  },
  z.core.$strict
>;

/** The sections a config's default export may hold, each parsed on its own. */
function baseConfigSchema(): BaseSchema {
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
      workflow: workflowSchema().optional(),
    },
    { error: "the default export must be an object; use `export default defineConfig({ ... })`" },
  );
}

/** The schema of a config's default export: each section checked against its pack, then the turbo task names. */
function buildConfigSchema(): BaseSchema {
  let schema = baseConfigSchema();

  for (const key of Object.keys(SECTION_PACKS) /* the keys of a literal object */ as (keyof SectionPacks)[]) {
    const pack = SECTION_PACKS[key];

    schema = schema.refine((config) => config[key] === undefined || hasPack(config, pack), needsPack(key, pack));
  }

  return schema.superRefine((config, ctx) => {
    for (const name of generatedNames(config.turbo)) ctx.addIssue({ code: "custom", message: generatedTask(name) });
  });
}

/** The schema of a config's default export. */
export const configSchema: BaseSchema = /* @__PURE__ */ buildConfigSchema();
