/** The `workflow` key of repo.config.ts: where changes are made and how they reach the default branch. */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { z } from "zod";

import { CONFIG_FILE, LAST } from "./config.constants.ts";

/** The workflows a repo can name, the default first. */
export const WORKFLOWS = ["worktree", "pull-request", "main"] as const;

/** One of `WORKFLOWS`: the value `workflow` takes. */
export type Workflow = (typeof WORKFLOWS)[number];

/** The workflow a repo gets when its config omits `workflow` or it has no config. */
export const DEFAULT_WORKFLOW: Workflow = "worktree";

/** What a guard reads the workflow as: a workflow, or "unreadable" when the config fails to load or holds a bad one. */
export type WorkflowRead = Workflow | "unreadable";

/** What a workflow lets an agent do in the main checkout and to the default branch. */
export type WorkflowRules = {
  /** Whether files in the main checkout may be written and commits made there. */
  readonly mainCheckoutWrites: boolean;
  /** Whether the default branch may be pushed. */
  readonly pushDefaultBranch: boolean;
};

/** Each read's rules; an unreadable config takes the strictest rule for each check. */
const RULES: Readonly<Record<WorkflowRead, WorkflowRules>> = {
  main: { mainCheckoutWrites: true, pushDefaultBranch: true },
  "pull-request": { mainCheckoutWrites: false, pushDefaultBranch: false },
  unreadable: { mainCheckoutWrites: false, pushDefaultBranch: false },
  worktree: { mainCheckoutWrites: false, pushDefaultBranch: true },
};

/** The schema of `workflow`: one of `WORKFLOWS`, refused with all three named. */
export function workflowSchema(): z.ZodEnum<{ [W in Workflow]: W }> {
  const names = WORKFLOWS.map((name) => JSON.stringify(name));

  return z.enum(WORKFLOWS, { error: `must be ${names.slice(0, LAST).join(", ")} or ${names.at(LAST)}` });
}

/** The part of a loaded config module `readWorkflow` reads: an object default export; its other keys pass unchecked. */
function moduleSchema() {
  return z.object({ default: z.object({ workflow: workflowSchema().optional() }) });
}

/** The rules `read` holds a main checkout and its default branch to. */
export function rulesOf(read: WorkflowRead): WorkflowRules {
  return RULES[read];
}

/**
 * The workflow `<root>/repo.config.ts` names, loaded synchronously for the guards: worktree when there is no config
 * or it omits `workflow`; unreadable when it throws as it loads, its default export is not an object, or the value
 * is not a workflow.
 */
export function readWorkflow(root: string): WorkflowRead {
  const file = path.join(root, CONFIG_FILE);

  if (!fs.existsSync(file)) return DEFAULT_WORKFLOW;
  let loaded: unknown;

  try {
    loaded = createRequire(import.meta.url)(file);
  } catch {
    return "unreadable";
  }

  const parsed = moduleSchema().safeParse(loaded);

  if (!parsed.success) return "unreadable";

  return parsed.data.default.workflow ?? DEFAULT_WORKFLOW;
}
