/** The `.gitignore` edits a Write, a search/replace or a Codex patch makes: the file and the lines it adds. */
import fs from "node:fs";
import path from "node:path";

import {
  COMMENT_MARK,
  DELETE_FILE,
  GITIGNORE,
  LINE_BREAK_RE,
  MOVE_TO,
  PATCH_HEADER_RE,
  PLUS_MARK,
} from "./gitignore-guard.constants.ts";
import type { IgnoreEdit, ToolArgs } from "./gitignore-guard.types.ts";
import { isRecord } from "./hook-input.ts";
import { canonicalPath } from "./workspace-root.ts";

/** One file section of a patch: the path its header names and its `+` lines. */
type PatchSection = { raw: string; plus: string[] };

function readText(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

export function linesOf(text: unknown): string[] {
  return String(text).split(LINE_BREAK_RE);
}

/** @returns the candidate lines the file does not hold yet, minus blanks and comments */
export function ignoreEdit(file: string, candidates: string[]): IgnoreEdit {
  const have = new Set(linesOf(readText(file)).map((l) => l.trimEnd()));
  const added: string[] = [];

  for (const raw of candidates) {
    const line = raw.trimEnd();

    if (line === "" || line.startsWith(COMMENT_MARK) || have.has(line) || added.includes(line)) continue;
    added.push(line);
  }

  return { added, file };
}

function firstString(values: unknown[]): string | undefined {
  return values.find((v): v is string => typeof v === "string");
}

/** `text` after one search/replace, or null when its old string is missing. */
function applyEdit(text: string, edit: unknown): string | null {
  const e: ToolArgs = isRecord(edit) ? edit : {};
  const oldStr = firstString([e.old_string, e.oldString, e.Target]);
  const newStr = firstString([e.new_string, e.newString, e.Replacement]);

  if (oldStr === undefined || newStr === undefined || !text.includes(oldStr)) return null;
  const isAll = Boolean(e.replace_all) || Boolean(e.replaceAll);

  return isAll ? text.split(oldStr).join(newStr) : text.replace(oldStr, () => newStr);
}

/** Apply the host's search/replace to `text`; null when an old string is missing (the host then fails the edit). */
export function projectEdit(text: string, args: ToolArgs): string | null {
  const edits: unknown[] = Array.isArray(args.edits) ? args.edits : [args];
  let next = text;

  for (const edit of edits) {
    const applied = applyEdit(next, edit);

    if (applied === null) return null;
    next = applied;
  }

  return next;
}

/** The absolute target when `raw` names a `.gitignore`, else null. */
export function ignoreTarget(raw: unknown, cwd: string, p: typeof path = path): string | null {
  if (typeof raw !== "string" || raw === "") return null;
  const abs = canonicalPath(p.resolve(cwd, raw), p);

  return p.basename(abs) === GITIGNORE ? abs : null;
}

/** The edit a Write or search/replace call makes to a `.gitignore` named in one of `fields`. */
export function writeIgnoreEdits(args: ToolArgs, cwd: string, fields: readonly string[]): IgnoreEdit[] {
  for (const key of fields) {
    const file = ignoreTarget(args[key], cwd);

    if (file === null) continue;
    const next = firstString([args.content, args.Content]) ?? projectEdit(readText(file), args);

    return next === null ? [] : [ignoreEdit(file, linesOf(next))];
  }

  return [];
}

/** Each file a patch adds or updates, with its `+` lines; a move renames the section above it. */
function patchSections(patch: string): PatchSection[] {
  const sections: PatchSection[] = [];
  let cur: PatchSection | null = null;

  for (const line of linesOf(patch)) {
    const m = PATCH_HEADER_RE.exec(line);

    if (m === null) {
      if (cur !== null && line.startsWith(PLUS_MARK)) cur.plus.push(line.slice(PLUS_MARK.length));
      continue;
    }

    const [, verb, target] = [...m] /* both groups match whenever the pattern does */ as [string, string, string];

    if (verb === MOVE_TO) {
      if (cur !== null) cur.raw = target.trim();
      continue;
    }

    cur = verb === DELETE_FILE ? null : { plus: [], raw: target.trim() };

    if (cur !== null) sections.push(cur);
  }

  return sections;
}

/** Each `.gitignore` a Codex patch adds or updates, with its `+` lines. */
export function patchIgnoreEdits(patch: string, cwd: string): IgnoreEdit[] {
  return patchSections(patch).flatMap((s) => {
    const file = ignoreTarget(s.raw, cwd);

    return file === null ? [] : [ignoreEdit(file, s.plus)];
  });
}
