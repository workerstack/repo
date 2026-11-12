import fs from "node:fs";
import path from "node:path";

import { ID_GROUP } from "./id-group.constants.ts";
import type { RepoRule } from "./rule.types.ts";

/** A comment line, past its `//`, `/*` or JSDoc `*`, that starts with the marker, and the `(…)` right after it. */
const MARKER = /^[\s*]*(TODO|FIXME)\b(?:\(([^)]*)\))?/;
const ISSUE = /^(?:#\d+|[A-Z][A-Z\d]*-\d+|https?:\/\/\S+)$/;
const SLUG = /^[a-z\d]+(?:-[a-z\d]+)*$/;

/** `path.join` reads `/` as the separator on every OS. */
const LESSONS = ".repo/lessons";

/** The nearest `.repo/lessons` dir at or above `start`, or null when none is. */
function nearestLessons(start: string): string | null {
  let dir = start;

  while (!fs.existsSync(path.join(dir, LESSONS))) {
    if (path.dirname(dir) === dir) return null;
    dir = path.dirname(dir);
  }

  return path.join(dir, LESSONS);
}

function shown(cwd: string, to: string): string {
  return path.relative(cwd, to).replaceAll("\\", "/");
}

/** Where the linted file is, and the dir paths in messages are relative to. */
type Where = { cwd: string; filename: string };

/** A report: which message, and the parts it fills in. */
type Problem = { messageId: "id" | "lesson"; data: Record<string, string> };

/** The problem of a slug that names no lesson file in the nearest lessons dir, or null when one is there. */
function lessonProblem(where: Where, slug: string): Problem | null {
  const dir = nearestLessons(path.dirname(where.filename)) ?? path.join(where.cwd, LESSONS);

  if (fs.existsSync(path.join(dir, `${slug}.md`))) return null;

  return { data: { dir: shown(where.cwd, dir), slug }, messageId: "lesson" };
}

/** The problem of one comment line, or null when it starts with no marker or carries a good ID. */
function problemOf(where: Where, line: string): Problem | null {
  const match = MARKER.exec(line);

  if (match === null) return null;
  const word = String(match[1]);
  const id = match[ID_GROUP] ?? "";

  if (ISSUE.test(id)) return null;

  if (SLUG.test(id)) return lessonProblem(where, id);

  return { data: { word }, messageId: "id" };
}

/**
 * Fails a `TODO` or `FIXME` that starts a comment or a JSDoc line without an ID someone can look up: `#12`, `ABC-12`,
 * an issue URL, or the slug of a lesson in the nearest `.repo/lessons/`. A mention mid-sentence is prose and passes.
 */
export const todoNeedsId: RepoRule<Problem["messageId"]> = {
  create(context) {
    const where: Where = { cwd: context.cwd, filename: context.filename };

    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          for (const line of comment.value.split("\n")) {
            const problem = problemOf(where, line);

            if (problem !== null) context.report({ ...problem, node: comment });
          }
        }
      },
    };
  },
  defaultOptions: [],
  meta: {
    messages: {
      id: "{{word}} needs an issue or lesson ID: {{word}}(#123), {{word}}(ABC-123) or {{word}}(<lesson slug>)",
      lesson: '"{{slug}}" names no lesson: add {{dir}}/{{slug}}.md, or use an issue ID like TODO(#123)',
    },
    schema: [],
    type: "problem",
  },
};
