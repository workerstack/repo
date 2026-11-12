/** What a review strategy and the shared main checkout ask of a write, a patch or a shell command. */
import fs from "node:fs";
import path from "node:path";

import { isRecord } from "../json.ts";
import { isImplementer, isParentOrchestrator, sessionIdOf } from "./gate-agents.ts";
import type { GateCall, GuardResult } from "./gate-call.ts";
import { TOOLS, isHookObject, toolCallOf, type Payload } from "./gate-harness.ts";
import { writeTargets } from "./gate-rewrites.ts";
import { BASH_GIT, GIT_STAGE, MD_EXT, REASON_IMPLEMENTER_GIT, REASON_IMPLEMENTER_WRITE } from "./gate.constants.ts";
import { ENFORCED_HARNESSES } from "./strategy.constants.ts";
import { activeReview, implementerOf, parseStrategy, stampPath, writeStamp } from "./strategy.ts";
import type { ActiveReview } from "./strategy.types.ts";
import { canonicalPath, resolveRoots } from "./workspace-root.ts";
import { gitAskedWords, mainCheckoutWriteReason, sharedGitReason } from "./worktree-guards.ts";

/** A plan's frontmatter block; group 1 is its body. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/** The `strategy:` line of a frontmatter body; group 1 is its value. */
const STRATEGY_LINE_RE = /^strategy:[ \t]*(\S+)/m;

/** True when the call carries a patch to apply. */
function holdsPatch(patch: string | null): boolean {
  return patch !== null && patch !== "";
}

/** True when `target` is not inside `dir`; both in the roots' spelling. */
function isOutside(p: typeof path, dir: string, target: string): boolean {
  const rel = p.relative(dir, target);

  return rel === ".." || rel.startsWith(`..${p.sep}`) || p.isAbsolute(rel);
}

/** True when `target` is not inside `<root>/.tmp`; both in the roots' spelling. */
export function isOutsideRootTmp(target: string, root: string, p: typeof path = path): boolean {
  return isOutside(p, canonicalPath(p.resolve(root, ".tmp"), p), target);
}

/** True when a plan's frontmatter holds a review strategy. */
function isReviewPlanText(text: string): boolean {
  const front = FRONTMATTER_RE.exec(text);
  const line = STRATEGY_LINE_RE.exec(front?.[1] ?? "");
  const strategy = parseStrategy(line?.[1]);

  return strategy !== null && strategy !== "default";
}

/** What a stamp needs to know of a plan save: the tool, its input, and the session it belongs to. */
type StampSite = Pick<GateCall, "tool" | "input" | "roots" | "sid">;

/** True when the save of `target` holds a review plan: the Write content, else the file on disk. */
function savesReviewPlan({ tool, input }: StampSite, target: string): boolean {
  const given = [input.content, input.Content, input.contents, input.file_text].find(
    (v): v is string => typeof v === "string",
  );

  return isReviewPlanText(tool.kind === "write" && given !== undefined ? given : fs.readFileSync(target, "utf8"));
}

/** A parent's save of a plan that holds a review strategy points the session at it. */
function stampReviewPlan(site: StampSite, targets: string[]): void {
  const plans = canonicalPath(path.join(site.roots.root, ".tmp", "repo", "plans"));
  const plan = targets.find((t) => path.dirname(t) === plans && path.extname(t) === MD_EXT && savesReviewPlan(site, t));

  if (plan !== undefined) writeStamp(site.roots.root, site.sid, plan);
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

    const parsed: unknown = JSON.parse(
      fs.readFileSync(path.join(path.dirname(stampPath(root, sid)), "git-asked.json"), "utf8"),
    );

    // A file that is not an object throws in the destructure the gate always used, which lands in the catch below.
    if (!isRecord(parsed)) return new Set();
    const words = parsed.words;

    return new Set(Array.isArray(words) ? words.filter((w): w is string => typeof w === "string") : []);
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

function reviewDenyReason(review: ActiveReview): string {
  return (
    `plan ${review.serial} runs strategy ${review.strategy}: this session reviews. ` +
    `Spawn ${implementerOf(review.strategy, 1)} for product writes; the plan, the journal and .tmp/ stay writable.`
  );
}

/** The deny for an implementer's write to the plan or the journal. */
function implementerWriteDeny(call: GateCall): GuardResult {
  const { roots } = call;
  const owned = ["plans", "implementations"].map((d) => canonicalPath(path.join(roots.root, ".tmp", "repo", d)));
  const hit = writeTargets(call).some((t) => owned.some((dir) => !isOutside(path, dir, t)));

  return hit ? { reason: REASON_IMPLEMENTER_WRITE, type: "deny" } : undefined;
}

/** A parent's write: a plan save stamps the session, and while a review plan runs no write outside `<root>/.tmp`. */
function parentWriteDeny(call: GateCall): GuardResult {
  const { roots, sid, harness } = call;
  const targets = writeTargets(call);
  stampReviewPlan(call, targets);
  const review = ENFORCED_HARNESSES.has(harness) ? activeReview(roots.root, sid) : null;

  if (review !== null && targets.some((t) => isOutsideRootTmp(t, roots.root)))
    return { reason: reviewDenyReason(review), type: "deny" };

  return undefined;
}

/**
 * What a review strategy asks of a write, and of an implementer's shell. Ahead of the write branch and the scout
 * return, so no early return skips it. An error in here lets the call through, as the gate does everywhere else.
 *   implementer-*  never writes the plan or the journal, never runs git add or git commit (every strategy)
 *   parent         a save of a review plan stamps the session; while that plan runs, no write outside `<root>/.tmp`
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
