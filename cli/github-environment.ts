import { z } from "zod";

import { getJson, type Got } from "./github-get-json.ts";
import type { Gh } from "./github-gh.ts";
import type { Plan, Write } from "./github-write.ts";
import {
  ENVIRONMENT_LABEL,
  EVALS_ENVIRONMENT,
  FIX,
  NOT_FOUND,
  PRIVATE_REFUSAL,
  RULE_REVIEWERS,
  RULE_WAIT_TIMER,
} from "./github.constants.ts";
import type { BranchPolicy, Current, Drift, Environment, EvalsEnvironment, Reviewer } from "./github.types.ts";

type Rules = Omit<Environment, "policies">;

/** The environment GitHub answers, as the rules `repo github` manages; a reviewer of another kind is a failure. */
function environmentSchema(): z.ZodType<Rules> {
  const reviewer = z.object({ reviewer: z.object({ id: z.number() }), type: z.enum(["User", "Team"]) });

  const rule = z.object({
    prevent_self_review: z.boolean().optional(),
    reviewers: z.array(reviewer).optional(),
    type: z.string(),
    wait_timer: z.number().optional(),
  });

  const policy = z.object({ custom_branch_policies: z.boolean(), protected_branches: z.boolean() }).nullable();

  return z
    .object({ deployment_branch_policy: policy, protection_rules: z.array(rule) })
    .transform(({ deployment_branch_policy: branchPolicy, protection_rules: rules }): Rules => {
      const required = rules.find((found) => found.type === RULE_REVIEWERS);
      const reviewers = (required?.reviewers ?? []).map((one): Reviewer => ({ id: one.reviewer.id, type: one.type }));
      const custom = branchPolicy?.custom_branch_policies === true ? "custom" : "protected";

      return {
        branches: branchPolicy === null ? "any" : custom,
        preventSelfReview: required?.prevent_self_review === true,
        reviewers,
        waitTimer: rules.find((found) => found.type === RULE_WAIT_TIMER)?.wait_timer ?? 0,
      };
    });
}

function policiesSchema(): z.ZodType<BranchPolicy[]> {
  return z
    .object({ branch_policies: z.array(z.object({ id: z.number(), name: z.string() })) })
    .transform((list) => list.branch_policies.map(({ id, name }) => ({ id, name })));
}

function userSchema(): z.ZodType<number> {
  return z.object({ id: z.number() }).transform((user) => user.id);
}

/** The environment at `path`, or null when GitHub answers 404; its branch policies are read only when custom. */
async function readFound(gh: Gh, path: string): Promise<Got<Environment | null>> {
  const rules = await getJson(gh, path, environmentSchema);

  if (!rules.ok) return rules.status === NOT_FOUND ? { ok: true, value: null } : rules;

  if (rules.value.branches !== "custom") return { ok: true, value: { ...rules.value, policies: [] } };
  const policies = await getJson(gh, `${path}/deployment-branch-policies`, policiesSchema);

  return policies.ok ? { ok: true, value: { ...rules.value, policies: policies.value } } : policies;
}

/** The `evals` environment of the repo at `base`, and the admin who would review it, read together. */
export async function readEnvironment(gh: Gh, base: string): Promise<Got<EvalsEnvironment>> {
  const [found, viewer] = await Promise.all([
    readFound(gh, `${base}/environments/${EVALS_ENVIRONMENT}`),
    getJson(gh, "user", userSchema),
  ]);

  if (!found.ok) return found;

  if (!viewer.ok) return viewer;

  return { ok: true, value: { found: found.value, viewerId: viewer.value } };
}

/** What is wrong with the rules of `found` for a repo whose default branch is `branch`, one phrase each. */
function wrongWith(found: Environment, branch: string): string[] {
  const names = found.policies.map((policy) => policy.name);
  const wrong: string[] = [];

  if (found.reviewers.length === 0) wrong.push("has no required reviewer");

  if (found.preventSelfReview) wrong.push("blocks self-review, so the one reviewer cannot approve a run");

  if (found.branches === "protected") wrong.push(`deploys from any protected branch, not only ${branch}`);

  if (found.branches === "custom" && !names.includes(branch)) wrong.push(`does not deploy from ${branch}`);

  if (found.branches === "any" || names.some((name) => name !== branch)) wrong.push(`deploys from more than ${branch}`);

  return wrong;
}

/**
 * Each way the `evals` environment differs from one that needs a reviewer's approval and deploys only from the
 * default branch; none when it was not read. Any `User` or `Team` reviewer is enough, so admins never fight.
 */
export function environmentDrift({ environment, defaultBranch }: Current): Drift[] {
  if (environment === undefined) return [];
  const wrong = environment.found === null ? ["is missing"] : wrongWith(environment.found, defaultBranch);

  return wrong.map((phrase) => ({ area: "environment", message: `${ENVIRONMENT_LABEL} ${phrase}: ${FIX}` }));
}

/** Whether the environment's PUT must run: it is missing, or its reviewer or branch rule is wrong. */
function needsPut(found: Environment | null): boolean {
  return found === null || found.reviewers.length === 0 || found.preventSelfReview || found.branches !== "custom";
}

/**
 * The PUT that keeps the environment's reviewers (or makes the viewer the one), lets self-review through, sends the
 * wait timer back and turns on custom branch policies. A private repo's PUT carries the refusal its plan may answer
 * with.
 */
function putWrite(path: string, { found, viewerId }: EvalsEnvironment, { isPrivate }: Current): Write {
  const kept = found?.reviewers ?? [];
  const reviewers: Reviewer[] = kept.length > 0 ? kept : [{ id: viewerId, type: "User" }];

  const body = {
    deployment_branch_policy: { custom_branch_policies: true, protected_branches: false },
    prevent_self_review: false,
    reviewers,
    wait_timer: found?.waitTimer ?? 0,
  };

  return { call: { body, method: "PUT", path }, ...(isPrivate ? { refusal: PRIVATE_REFUSAL } : {}) };
}

/** A policy for `branch` when there is none, and a DELETE for every other policy. */
function policyWrites(path: string, policies: readonly BranchPolicy[], branch: string): Write[] {
  const list = `${path}/deployment-branch-policies`;
  const others = policies.filter(({ name }) => name !== branch);

  const deletes = others.map((policy): Write => ({ call: { method: "DELETE", path: `${list}/${policy.id}` } }));

  if (others.length < policies.length) return deletes;

  return [{ call: { body: { name: branch, type: "branch" }, method: "POST", path: list } }, ...deletes];
}

/**
 * The calls that fix the `evals` environment: the PUT when its rules are wrong, then the branch policies; the last
 * call says whether it was created or updated. None when it was not read or has no drift.
 */
export function environmentWrites({ slug, current, drifts }: Plan): Write[] {
  const { environment, defaultBranch } = current;

  if (environment === undefined || !drifts.some((drift) => drift.area === "environment")) return [];
  const { found } = environment;
  const path = `repos/${slug}/environments/${EVALS_ENVIRONMENT}`;
  const put = needsPut(found) ? [putWrite(path, environment, current)] : [];
  const policies = found?.branches === "custom" ? found.policies : [];
  const writes = [...put, ...policyWrites(path, policies, defaultBranch)];
  const part = `${ENVIRONMENT_LABEL} ${found === null ? "created" : "updated"}`;

  return writes.map((write, index) => (index === writes.length - 1 ? { ...write, part } : write));
}
