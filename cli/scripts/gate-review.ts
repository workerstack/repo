/** What a spawn strategy and the shared main checkout ask of a write, a patch or a shell command. */
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { tryJson } from "../json.ts";
import { isIgnoredRepoPath, repoPath } from "../repo-dirs.ts";
import { isImplementer, isParentOrchestrator, sessionIdOf } from "./gate-agents.ts";
import type { GateCall, GuardResult } from "./gate-call.ts";
import { TOOLS, isHookObject, toolCallOf, type Payload } from "./gate-harness.ts";
import { writeTargets } from "./gate-rewrites.ts";
import { BASH_GIT, GIT_STAGE, MD_EXT, REASON_IMPLEMENTER_GIT, REASON_IMPLEMENTER_WRITE } from "./gate.constants.ts";
import { reviewDenyReason } from "./review-deny-reason.ts";
import { activeReviews, keepsStamp, pruneStamps, sessionDir, stampPlan, unstampPlan } from "./review-stamps.ts";
import { ENFORCED_HARNESSES, PLAN_DIRS } from "./strategy.constants.ts";
import { canonicalPath, resolveRoots } from "./workspace-root.ts";
import { gitAskedWords, mainCheckoutWriteReason, sharedGitReason } from "./worktree-guards.ts";

/** True when the call carries a patch to apply. */
function holdsPatch(patch: string | null): boolean {
  return patch !== null && patch !== "";
}

/** True when `target` is not inside `dir`; both in the roots' spelling. */
function isOutside(p: typeof path, dir: string, target: string): boolean {
  const rel = p.relative(dir, target);

  return rel === ".." || rel.startsWith(`..${p.sep}`) || p.isAbsolute(rel);
}

/** True when `target` is not inside one of the root's ignored `.repo` dirs; both in the roots' spelling. */
export function isOutsideRootRepoDirs(target: string, root: string, p: typeof path = path): boolean {
  return !isIgnoredRepoPath(canonicalPath(root, p), canonicalPath(target, p), p);
}

/** What a stamp needs to know of a plan save: the tool, its input, and the session it belongs to. */
type StampSite = Pick<GateCall, "tool" | "input" | "roots" | "sid">;

/** The text a save of `target` leaves: the Write content, else the file on disk. */
function savedText({ tool, input }: StampSite, target: string): string {
  const given = [input.content, input.Content, input.contents, input.file_text].find(
    (v): v is string => typeof v === "string",
  );

  return tool.kind === "write" && given !== undefined ? given : fs.readFileSync(target, "utf8");
}

/**
 * A parent's save of a plan or fast plan prunes every stamp whose plan ended, then stamps each saved plan that keeps
 * a spawn strategy at ready or in-progress and unstamps each that does not.
 */
function stampReviewPlan(site: StampSite, targets: string[]): void {
  const { root } = site.roots;
  const dirs = Object.values(PLAN_DIRS).map((d) => canonicalPath(repoPath(root, d)));
  const plans = targets.filter((t) => dirs.includes(path.dirname(t)) && path.extname(t) === MD_EXT);

  if (plans.length === 0) return;
  pruneStamps(root, site.sid);

  for (const t of plans) (keepsStamp(savedText(site, t)) ? stampPlan : unstampPlan)(root, site.sid, t);
}

/**
 * Stamp the session for a full-content Write of a plan. orchestrate-parent persists that Write itself and answers
 * before the gate runs, so it calls this first; every other save reaches the gate. Fails open.
 */
export function stampPlanSave(data: Payload): void {
  try {
    if (!isHookObject(data)) return;
    const sid = sessionIdOf(data);

    if (sid === "" || !isParentOrchestrator(data)) return;
    const { harness, key, args: input } = toolCallOf(data);
    const tool = TOOLS[harness].get(key);

    if (tool === undefined || tool.kind !== "write" || input === null) return;
    const roots = resolveRoots(data);
    stampReviewPlan({ input, roots, sid, tool }, writeTargets({ input, patch: null, roots, tool }));
  } catch {
    // A stamp error never blocks a save.
  }
}

/**
 * The git grant words the user's latest message named, from the session's `git-asked.json`; empty when anything is
 * missing or malformed.
 */
function gitAskedBy(root: string, sid: string): Set<string> {
  try {
    if (sid === "") return new Set();

    const text = fs.readFileSync(path.join(sessionDir(root, sid), "git-asked.json"), "utf8");

    return new Set(tryJson(z.looseObject({ words: z.array(z.string()) }), text)?.words);
  } catch {
    return new Set();
  }
}

/**
 * The deny reason for a write or patch that lands in the main checkout, or a shell command that commits or destroys
 * work there or hits shared refs. Ahead of every early return, so scouts, implementers and every harness are held
 * to it.
 * An error in here lets the call through, as the gate does everywhere else.
 * Antigravity has no prompt event, so its git grant is the words in the call's own `lastUserInput` (empty in a
 * subagent's calls); every other harness's grant is the session's `git-asked.json`.
 */
function sharedCheckoutReason(call: GateCall): string | null {
  const { tool, patch, text, roots, shellCwd, sid, harness, data } = call;

  if (tool.kind === "write" || holdsPatch(patch)) {
    for (const target of writeTargets(call)) {
      const reason = mainCheckoutWriteReason(target, roots);

      if ((reason ?? "") !== "") return reason;
    }
  }

  if (tool.kind !== "bash" || !BASH_GIT.test(text)) return null;
  const asked = harness === "antigravity" ? new Set(gitAskedWords(data.lastUserInput)) : gitAskedBy(roots.root, sid);

  return sharedGitReason(text, { asked, cwd: shellCwd, roots });
}

export function sharedCheckoutGuard(call: GateCall): GuardResult {
  try {
    const reason = sharedCheckoutReason(call);

    return reason === null || reason === "" ? undefined : { reason, type: "deny" };
  } catch {
    return undefined;
  }
}

/** The deny for an implementer's write to the plan or the journal. */
function implementerWriteDeny(call: GateCall): GuardResult {
  const { roots } = call;
  const owned = ["plans", "implementations"].map((d) => canonicalPath(repoPath(roots.root, d)));
  const hit = writeTargets(call).some((t) => owned.some((dir) => !isOutside(path, dir, t)));

  return hit ? { reason: REASON_IMPLEMENTER_WRITE, type: "deny" } : undefined;
}

/**
 * A parent's write: a plan save stamps the session, and while a review plan runs no write outside
 * `<root>/.repo/<ignored dir>`.
 */
function parentWriteDeny(call: GateCall): GuardResult {
  const { roots, sid, harness } = call;
  const targets = writeTargets(call);
  stampReviewPlan(call, targets);
  const [first, ...rest] = ENFORCED_HARNESSES.has(harness) ? activeReviews(roots.root, sid) : [];

  if (first !== undefined && targets.some((t) => isOutsideRootRepoDirs(t, roots.root)))
    return { reason: reviewDenyReason([first, ...rest]), type: "deny" };

  return undefined;
}

/**
 * What a spawn strategy asks of a write, and of an implementer's shell. Ahead of the write branch and the scout
 * return, so no early return skips it. An error in here lets the call through, as the gate does everywhere else.
 *   implementer-*  never writes the plan or the journal, never runs git add or git commit (every strategy)
 *   parent         a save of a spawn plan or fast plan stamps the session; while one runs, no write outside
 *                  `<root>/.repo/<ignored dir>`
 */
export function reviewGuard(call: GateCall): GuardResult {
  try {
    const { tool, patch, text, sub, sid, parent } = call;
    const implementer = isImplementer(sub);

    if (implementer && tool.kind === "bash" && GIT_STAGE.test(text))
      return { reason: REASON_IMPLEMENTER_GIT, type: "deny" };

    if (tool.kind !== "write" && !holdsPatch(patch)) return undefined;

    if (implementer) return implementerWriteDeny(call);

    return sid !== "" && parent ? parentWriteDeny(call) : undefined;
  } catch {
    return undefined;
  }
}
