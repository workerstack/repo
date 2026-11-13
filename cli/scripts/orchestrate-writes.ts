/**
 * The parent's writes: saves under .repo answered with the persisted text, and the session's receipt and git
 * ask.
 */
import fs from "node:fs";
import path from "node:path";

import { isString } from "../json.ts";
import { REPO, STATE } from "../repo-dirs.ts";
import type { ToolArgs } from "./gate-harness.ts";
import { rewriteScratchPath } from "./gate-rewrites.ts";
import type { HookInput } from "./hook-input.ts";
import { projectEdit } from "./ignore-edits.ts";
import { holdingCheckout } from "./lessons-ops.ts";
import { isLessonFile, lessonWrite } from "./orchestrate-lessons.ts";
import { contentOf, denyWith, savedReply, writeTarget } from "./orchestrate-reply.ts";
import { countsLine, isRealSession, recordApproval, sessionDir, sessionIdOf } from "./orchestrate-session.ts";
import { firstNonEmptyStripped } from "./orchestrate-transcript.ts";
import { DENY_REASON, RECEIPT_HEAD_CHARS } from "./orchestrate.constants.ts";
import type { Approvable, HookResult, Persist, PersistOutcome, WriteCase } from "./orchestrate.types.ts";
import { persistHandoff } from "./persist-handoff.ts";
import { validateImplementation } from "./persist-implementation-validate.ts";
import { isFullImplementationBody, persistImplementation } from "./persist-implementation.ts";
import { validatePlan } from "./persist-plan-validate.ts";
import { persistPlan, preparePlanUpdate } from "./persist-plan.ts";
import { validateRoadmap } from "./persist-roadmap-validate.ts";
import { persistRoadmap, prepareRoadmapUpdate } from "./persist-roadmap.ts";
import { isUnderRepoDir, isUnderTmp, persistTmp } from "./persist-tmp.ts";
import { stampPath as strategyStampPath } from "./strategy.ts";
import { canonicalPath, resolveRoots } from "./workspace-root.ts";
import { gitAskedWords } from "./worktree-guards.ts";

/** A write saved through `persist`; an approvable one is recorded for an `i`. */
type PersistRoute = { persist: Persist; approvable: boolean };

/** How a write is answered: already decided (null passes it to the host), or saved through `persist`. */
type Route = { done: HookResult | null } | PersistRoute;

type Prepare = (args: Parameters<Persist>[0] & { filePath: string }) => PersistOutcome;

type Validate = (name: string, text: string, opts: { fresh: boolean; previous: string }) => string[];

/** How a saved plan or roadmap is checked, updated in place, and saved fresh. */
const IMPL_NAME_LINE = /^\s*IMPL_NAME:/m;
const SID_UNSAFE = /[^\w-]/g;

const SAVED: Readonly<Record<Approvable["kind"], { validate: Validate; prepare: Prepare; persist: Persist }>> = {
  plan: { persist: persistPlan, prepare: preparePlanUpdate, validate: validatePlan },
  roadmap: { persist: persistRoadmap, prepare: prepareRoadmapUpdate, validate: validateRoadmap },
};

function isFile(abs: string): boolean {
  try {
    return fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

// An Edit of a saved plan or roadmap is checked against the text it would produce; a valid one runs as sent.
function savedEdit(write: WriteCase, abs: string, validate: Validate): HookResult | null {
  const previous = fs.readFileSync(abs, "utf8");
  const next = projectEdit(previous, write.toolInput);

  if (next == null) return null;
  const errors = validate(path.basename(abs), next, { fresh: false, previous });

  return errors.length > 0 ? denyWith(write.data, errors.join("; ")) : null;
}

/** A plan or roadmap: an Edit of a saved one is validated, and a valid one counts as a save; a Write is persisted. */
function savedRoute(write: WriteCase, kind: Approvable["kind"]): Route {
  const abs = path.resolve(write.rawPath);
  const exists = isFile(abs);
  const saved = SAVED[kind];

  if (exists && !isString(write.toolInput.content)) {
    const denied = savedEdit(write, abs, saved.validate);

    if (denied === null) recordApproval(write.data, abs);

    return { done: denied };
  }

  const persist: Persist = exists ? (args) => saved.prepare({ ...args, filePath: abs }) : saved.persist;

  return { approvable: true, persist };
}

/** A named implementation is persisted; a full body over a saved one is validated and lands as sent. */
function implementationRoute(write: WriteCase): Route {
  const abs = path.resolve(write.rawPath);
  const content = contentOf(write.toolInput);

  if (IMPL_NAME_LINE.test(content) || !isFile(abs)) return { approvable: false, persist: persistImplementation };

  if (!isFullImplementationBody(content)) return { done: null };
  const errors = validateImplementation(path.basename(abs), content);

  if (errors.length > 0) return { done: denyWith(write.data, errors.join("; ")) };

  return { done: savedReply(write.data, write.toolInput, { abs, content }) };
}

function routeWrite(write: WriteCase): Route {
  const { canon } = write;
  const ws = write.roots.root;

  if (isUnderRepoDir(canon, ws, "plans")) return savedRoute(write, "plan");

  if (isUnderRepoDir(canon, ws, "roadmaps")) return savedRoute(write, "roadmap");

  if (isUnderRepoDir(canon, ws, "handoffs")) return { approvable: false, persist: persistHandoff };

  if (isUnderRepoDir(canon, ws, "implementations")) return implementationRoute(write);

  if (isUnderTmp(canon, ws)) return { approvable: false, persist: persistTmp };

  return { done: null };
}

function persistWrite(write: WriteCase, { persist, approvable }: PersistRoute): HookResult {
  const ws = write.roots.root;
  const result = persist({ checkout: write.roots.checkout, content: contentOf(write.toolInput), workspaceRoot: ws });

  if (!result.ok) return denyWith(write.data, result.error);
  const saved = path.resolve(ws, result.path);

  if (approvable) recordApproval(write.data, saved);

  return savedReply(write.data, write.toolInput, { abs: saved, content: result.content });
}

/** The answer to a parent Write or Edit under `.repo` or a lessons dir; null when the host should run it as sent. */
export function parentWrite(data: HookInput, toolInput: ToolArgs | undefined): HookResult | null {
  if (toolInput === undefined) return denyWith(data, DENY_REASON);
  const roots = resolveRoots(data);
  const typed = writeTarget(toolInput);

  if (typed === "") return null;
  const rawPath = rewriteScratchPath(typed, roots) ?? path.resolve(roots.cwd, typed);
  // Classify in the roots' spelling; answers keep the typed spelling, which Claude Code's read-before-write knows.
  const write: WriteCase = { canon: canonicalPath(rawPath), data, rawPath, roots, toolInput };
  const holder = holdingCheckout(write.canon, roots);

  if (isLessonFile(write.canon, holder)) return lessonWrite(write, holder);
  const route = routeWrite(write);

  return "done" in route ? route.done : persistWrite(write, route);
}

export function writeSessionReceipt(data: HookInput, msg: string): void {
  const sid = sessionIdOf(data);

  if (!isRealSession(sid)) return;
  const dir = sessionDir(data, sid);

  try {
    fs.mkdirSync(dir, { recursive: true });
    const first = firstNonEmptyStripped(msg).slice(0, RECEIPT_HEAD_CHARS);
    const lines = [first, countsLine(dir), `session=${REPO}/${STATE}/sessions/${sid}/`].filter(Boolean);
    fs.writeFileSync(path.join(dir, "receipt.txt"), `${lines.join("\n")}\n`);
  } catch {
    // fail-open
  }
}

// What git the user's latest message asked for, read by the gate; each prompt overwrites it, so an empty list
// clears it.
export function writeGitAsked(data: HookInput, prompt: string): void {
  const sid = sessionIdOf(data);

  // The gate finds this file beside the session's strategy stamp, with the sid cleaned the same way.
  if (sid.replaceAll(SID_UNSAFE, "") === "") return;

  try {
    const dir = path.dirname(strategyStampPath(resolveRoots(data).root, sid));
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, "git-asked.json");
    const tmp = `${dest}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ words: gitAskedWords(prompt) }));
    fs.renameSync(tmp, dest);
  } catch {
    // fail-open: no stamp means no grant
  }
}
