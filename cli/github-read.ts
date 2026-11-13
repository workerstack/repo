import { z } from "zod";

import { readEnvironment } from "./github-environment.ts";
import { UNEXPECTED, getJson, type Got } from "./github-get-json.ts";
import type { Gh, GhFailure } from "./github-gh.ts";
import { ENABLED, MAIN_RULESET, NOT_FOUND, TAGS_RULESET } from "./github.constants.ts";
import type { Current, CurrentRuleset, Wanted } from "./github.types.ts";

export type ReadResult = { ok: true; current: Current } | GhFailure;

const MANAGED = [MAIN_RULESET, TAGS_RULESET];

function listSchema(): z.ZodType<{ id: number; name: string }[]> {
  return z.array(z.object({ id: z.number(), name: z.string() }));
}

function parameters() {
  return z.object({
    required_approving_review_count: z.number().optional(),
    required_status_checks: z
      .array(z.object({ context: z.string(), integration_id: z.number().optional() }))
      .optional(),
    strict_required_status_checks_policy: z.boolean().optional(),
  });
}

function rulesetSchema(): z.ZodType<CurrentRuleset> {
  return z
    .object({
      bypass_actors: z.array(
        z.object({ actor_id: z.number().nullable(), actor_type: z.string(), bypass_mode: z.string() }),
      ),
      conditions: z.object({ ref_name: z.object({ exclude: z.array(z.string()), include: z.array(z.string()) }) }),
      enforcement: z.string(),
      id: z.number(),
      name: z.string(),
      rules: z.array(z.object({ parameters: parameters().optional(), type: z.string() })),
      target: z.string(),
    })
    .transform((ruleset) => ({
      ...ruleset,
      bypass_actors: ruleset.bypass_actors.map((actor) => ({ ...actor, actor_id: actor.actor_id ?? 0 })),
    }));
}

type Repo = {
  default_branch: string;
  private: boolean;
  description: string;
  homepage: string;
  topics: string[];
  security_and_analysis?: Security | undefined;
};

type Status = { status: string };

type Security = {
  dependabot_security_updates: Status;
  secret_scanning: Status;
  secret_scanning_push_protection: Status;
};

function repoSchema(): z.ZodType<Repo> {
  const status = z.object({ status: z.string() });

  return z.object({
    default_branch: z.string(),
    description: z
      .string()
      .nullable()
      .transform((text) => text ?? ""),
    homepage: z
      .string()
      .nullable()
      .transform((text) => text ?? ""),
    private: z.boolean(),
    security_and_analysis: z
      .object({
        dependabot_security_updates: status,
        secret_scanning: status,
        secret_scanning_push_protection: status,
      })
      .optional(),
    topics: z.array(z.string()),
  });
}

function enabledSchema(): z.ZodType<{ enabled: boolean }> {
  return z.object({ enabled: z.boolean() });
}

/** The managed rulesets: the list first, then each managed one by id, together. */
async function readRulesets(gh: Gh, base: string): Promise<Got<CurrentRuleset[]>> {
  const list = await getJson(gh, `${base}/rulesets`, listSchema);

  if (!list.ok) return list;
  const found = list.value.filter((entry) => MANAGED.includes(entry.name));
  const each = await Promise.all(found.map((entry) => getJson(gh, `${base}/rulesets/${entry.id}`, rulesetSchema)));
  const rulesets: CurrentRuleset[] = [];

  for (const result of each) {
    if (!result.ok) return result;
    rulesets.push(result.value);
  }

  return { ok: true, value: rulesets };
}

/** Dependabot alerts answer 204 when on and 404 when off. */
async function readAlerts(gh: Gh, base: string): Promise<Got<boolean>> {
  const result = await gh({ method: "GET", path: `${base}/vulnerability-alerts` });

  if (result.ok) return { ok: true, value: true };

  return result.status === NOT_FOUND ? { ok: true, value: false } : result;
}

/**
 * Everything `repo github` manages, read with every call started together; the first failure is the answer. The
 * `evals` environment is read only when `wanted` has it, so a repo without the evals pack pays no call for it.
 */
export async function readCurrent(gh: Gh, slug: string, wanted: Wanted): Promise<ReadResult> {
  const base = `repos/${slug}`;

  const [rulesets, repo, reporting, alerts, environment] = await Promise.all([
    readRulesets(gh, base),
    getJson(gh, base, repoSchema),
    getJson(gh, `${base}/private-vulnerability-reporting`, enabledSchema),
    readAlerts(gh, base),
    wanted.environment ? readEnvironment(gh, base) : undefined,
  ]);

  if (!rulesets.ok) return rulesets;

  if (!repo.ok) return repo;

  if (!reporting.ok) return reporting;

  if (!alerts.ok) return alerts;

  if (environment !== undefined && !environment.ok) return environment;
  const { description, homepage, topics, security_and_analysis: security } = repo.value;

  // A repo answer without the key (a token that cannot see it) is a failure: never read as "on".
  if (security === undefined) return UNEXPECTED;

  const current = {
    alerts: alerts.value,
    pushProtection: security.secret_scanning_push_protection.status === ENABLED,
    reporting: reporting.value.enabled,
    rulesets: rulesets.value,
    scanning: security.secret_scanning.status === ENABLED,
    securityUpdates: security.dependabot_security_updates.status === ENABLED,
  };

  const repoFields = { defaultBranch: repo.value.default_branch, description, homepage, isPrivate: repo.value.private };
  const read = environment === undefined ? {} : { environment: environment.value };

  return { current: { ...current, ...repoFields, ...read, topics }, ok: true };
}
