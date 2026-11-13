/**
 * Lessons in the write hook: a lesson Write is saved through the lessons module, and a match is shown once a
 * session.
 */
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { isString, tryJson } from "../json.ts";
import { STATE, isIgnoredRepoPath, repoPath } from "../repo-dirs.ts";
import type { ToolArgs } from "./gate-harness.ts";
import { rewriteScratchPath } from "./gate-rewrites.ts";
import type { HookInput } from "./hook-input.ts";
import { holdingCheckout, matchLessons, persistLesson } from "./lessons-ops.ts";
import { LESSONS_DIR } from "./lessons.constants.ts";
import { denyWith, savedReply, writeTarget } from "./orchestrate-reply.ts";
import { sessionIdOf } from "./orchestrate-session.ts";
import type { ContextReply, HookResult, WriteCase } from "./orchestrate.types.ts";
import { isUnderDir } from "./persist-tmp.ts";
import { canonicalPath, resolveRoots, resolveTyped, type Roots } from "./workspace-root.ts";
import { mainCheckoutWriteReason } from "./worktree-guards.ts";

type LessonRow = ReturnType<typeof matchLessons>[number];

export function isLessonFile(filePath: string, workspaceRoot: string | null | undefined): boolean {
  return isUnderDir(filePath, workspaceRoot, LESSONS_DIR.split("/"));
}

function readSeen(seenFile: string): string[] {
  try {
    return tryJson(z.array(z.string()), fs.readFileSync(seenFile, "utf8")) ?? [];
  } catch {
    return [];
  }
}

/** The rows this session has not been shown, recorded as shown; with no session every row is fresh. */
function unseenRows(data: HookInput, roots: Roots, rows: LessonRow[]): LessonRow[] {
  const sid = sessionIdOf(data);
  const seenFile = sid === "" ? "" : repoPath(roots.root, STATE, "sessions", sid, "lessons-seen.json");
  const seen = seenFile === "" ? [] : readSeen(seenFile);
  const fresh = rows.filter((r) => !seen.includes(r.file));

  if (seenFile !== "" && fresh.length > 0) {
    fs.mkdirSync(path.dirname(seenFile), { recursive: true });
    fs.writeFileSync(seenFile, JSON.stringify([...seen, ...fresh.map((r) => r.file)]));
  }

  return fresh;
}

function noticeFor(data: HookInput, toolInput: ToolArgs): ContextReply | null {
  const roots = resolveRoots(data);
  const target = writeTarget(toolInput);

  if (target === "") return null;
  const abs = resolveTyped(roots, target);
  const holder = holdingCheckout(abs, roots);

  if (isLessonFile(abs, holder) || rewriteScratchPath(abs, roots) !== null || isIgnoredRepoPath(roots.root, abs))
    return null;
  const fresh = unseenRows(data, roots, matchLessons({ files: [abs], roots }));

  if (fresh.length === 0) return null;
  const rel = path.relative(holder, abs).split(path.sep).join("/");
  const lines = fresh.map((r) => `- ${r.file} (hits ${r.hits}): ${r.title}`);

  return {
    hookSpecificOutput: {
      additionalContext: `Recorded lessons match ${rel}:\n${lines.join("\n")}`,
      hookEventName: "PreToolUse",
    },
  };
}

// Lessons that match a file this session edits, each shown once per session. Fails open.
export function lessonNotice(data: HookInput, toolInput: ToolArgs): ContextReply | null {
  try {
    return noticeFor(data, toolInput);
  } catch {
    return null; // A lessons read error never blocks an edit.
  }
}

// A lesson Write is validated, rendered, and reindexed in the checkout that holds it, and the host saves it; an Edit
// cannot be reindexed before it lands. The main checkout takes none: the deny answers here, since the gate never
// sees this Write.
export function lessonWrite(write: WriteCase, ws: string): HookResult {
  const { data, roots, rawPath, toolInput } = write;
  const abs = path.resolve(ws, rawPath);
  const shared = mainCheckoutWriteReason(abs, roots);

  if (shared !== null) return denyWith(data, shared);
  const body = toolInput.content;

  if (!isString(body)) {
    return denyWith(
      data,
      "Edit is not allowed on lesson files. Write the full lesson (title 72, Mistake 280, Fix 360 chars max) " +
        "or run bun repo lessons hit <slug> --evidence <text>",
    );
  }

  const result = persistLesson({ content: body, filePath: canonicalPath(abs), workspaceRoot: ws });

  if (!result.ok) return denyWith(data, result.error);

  return savedReply(data, toolInput, { abs, content: result.content });
}
