#!/usr/bin/env bun
/** Lessons: one committed file per repeat mistake under .repo/lessons/, plus a generated index. */
import path from "node:path";

import { checkLessons } from "./lessons-check.ts";
import { writeIndex } from "./lessons-index.ts";
import { hitLesson, mainCheckoutRefusal, matchLessons, removeLesson } from "./lessons-ops.ts";
import { EVIDENCE_FLAG, LESSONS_DIR, NOT_FOUND, USAGE } from "./lessons.constants.ts";
import type { Roots } from "./lessons.types.ts";
import { resolveRoots } from "./workspace-root.ts";

/** One verb of `repo lessons`: its arguments after the verb, and the roots it runs in. */
type Verb = (rest: string[], roots: Roots) => number;

function fail(msg: string): number {
  process.stderr.write(`${msg}\n`);

  return 1;
}

function matchVerb(rest: string[], roots: Roots): number {
  if (rest.length === 0) return fail(USAGE);

  for (const r of matchLessons({ files: rest.map((f) => path.resolve(roots.cwd, f)), roots }))
    process.stdout.write(`${r.file} (hits ${r.hits}): ${r.summary}\n`);

  return 0;
}

function hitVerb(rest: string[], roots: Roots): number {
  const at = rest.indexOf(EVIDENCE_FLAG);
  const [slug = ""] = rest;
  const evidence = at === NOT_FOUND ? "" : (rest[at + 1] ?? "");

  if (slug === "" || slug === EVIDENCE_FLAG || evidence === "") return fail(USAGE);
  const r = hitLesson({ evidence, slug, workspaceRoot: roots.checkout });

  if (!r.ok) return fail(r.error);
  process.stdout.write(`${LESSONS_DIR}/${slug}.md hits ${r.hits}\n`);

  return 0;
}

function rmVerb(rest: string[], roots: Roots): number {
  const [slug = ""] = rest;

  if (slug === "") return fail(USAGE);
  const r = removeLesson({ slug, workspaceRoot: roots.checkout });

  return r.ok ? 0 : fail(r.error);
}

function indexVerb(rest: string[], roots: Roots): number {
  if (rest.length > 0) return fail(USAGE);
  const refusal = mainCheckoutRefusal(roots.checkout);

  if (refusal !== null) return fail(refusal);
  writeIndex({ workspaceRoot: roots.checkout });

  return 0;
}

function checkVerb(rest: string[], roots: Roots): number {
  if (rest.length > 0) return fail(USAGE);
  const errors = checkLessons({ workspaceRoot: roots.checkout });

  return errors.length === 0 ? 0 : fail(errors.join("\n"));
}

const VERBS: ReadonlyMap<string, Verb> = /* @__PURE__ */ new Map([
  ["match", matchVerb],
  ["hit", hitVerb],
  ["rm", rmVerb],
  ["index", indexVerb],
  ["check", checkVerb],
]);

export function main(argv: string[], roots: () => Roots = resolveRoots): number {
  try {
    const at = roots();
    const [cmd = "", ...rest] = argv;
    const verb = VERBS.get(cmd);

    return verb === undefined ? fail(USAGE) : verb(rest, at);
  } catch (err) {
    return fail((err /* fs, JSON and the roots lookup throw Errors */ as Error).message);
  }
}
