/**
 * Runs an oxlint JS plugin rule in process, the way oxlint hands it each file, over fixture files written to a temp
 * dir. oxlint's own `RuleTester` refuses bun, so this parses with `oxc-parser`, oxlint's parser; `cli/scripts/
 * lint.test.ts` runs each rule through real oxlint too.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Context, CreateRule } from "@oxlint/plugins";
import { parseSync } from "oxc-parser";

import { PARENT_KEY } from "./parent-key.constants.ts";

/** Repo-relative path → source; package.json files among them are read by rules that read manifests. */
export type Fixture = Record<string, string>;
/** One finding: the fixture path it is in and the rule's message. */
export type Report = { file: string; message: string };

type Comment = { start: number; end: number; type: string; value: string };
type Node = { start: number; end: number; type: string; parent?: Node | null };
type Visitors = Record<string, ((node: never) => void) | undefined>;

/** The comments that touch `node` before it with only whitespace between, as oxlint's `SourceCode` reports them. */
function commentsBefore(code: string, comments: readonly Comment[], node: Node): Comment[] {
  const out: Comment[] = [];
  let edge = node.start;
  for (const comment of comments.toReversed()) {
    if (comment.end > edge) continue;
    if (code.slice(comment.end, edge).trim() !== "") break;
    out.unshift(comment);
    edge = comment.start;
  }
  return out;
}

function commentsAfter(code: string, comments: readonly Comment[], node: Node): Comment[] {
  const out: Comment[] = [];
  let edge = node.end;
  for (const comment of comments) {
    if (comment.start < edge) continue;
    if (code.slice(edge, comment.start).trim() !== "") break;
    out.push(comment);
    edge = comment.end;
  }
  return out;
}

/** Calls `visit` on every node under `node` with its parent, parents before children. */
function walk(node: unknown, parent: Node | null, visit: (node: Node, parent: Node | null) => void): void {
  if (typeof node !== "object" || node === null || !("type" in node)) return;
  const record = node /* an object with a `type`; every oxc node also has numeric start and end */ as Node;
  visit(record, parent);
  for (const [key, value] of Object.entries(record)) {
    if (key === PARENT_KEY) continue;
    for (const child of Array.isArray(value) ? value : [value]) walk(child, record, visit);
  }
}

/** As oxlint does, every node has its `parent` before any visitor runs. */
function visitAll(program: unknown, visitors: Visitors): void {
  walk(program, null, (node, parent) => {
    node.parent = parent;
  });
  walk(program, null, (node) =>
    visitors[node.type]?.(node /* the visitor is picked by this node's own type, so it takes this node */ as never),
  );
}

type Lint = { dir: string; file: string; code: string; reports: Report[] };

function lintFile(rule: Pick<CreateRule, "create">, { dir, file, code, reports }: Lint): void {
  const filename = path.join(dir, file);
  const parsed = parseSync(filename, code);
  const comments =
    parsed.comments /* oxc-parser's comments carry start, end, type and value, the fields Comment lists */ as Comment[];
  const context = {
    cwd: dir,
    filename,
    options: [],
    report: ({ message }: { message?: string | null }) => reports.push({ file, message: message ?? "" }),
    sourceCode: {
      getAllComments: () => comments,
      getCommentsAfter: (node: Node) => commentsAfter(code, comments, node),
      getCommentsBefore: (node: Node) => commentsBefore(code, comments, node),
      getText: () => code,
      text: code,
    },
  };
  const visitors = rule.create(
    context /* the fake holds the Context members the rules read */ as unknown /* the rest stay unset */ as Context,
  ) /* create returns the visitor map oxlint calls by node type */ as Visitors;
  visitAll(parsed.program, visitors);
}

/** What `rule` reports over every `.ts` file of `fixture`, in fixture order; the temp dir is gone after. */
export function reportsOf(rule: Pick<CreateRule, "create">, fixture: Fixture): Report[] {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-rule-")));
  try {
    for (const [file, code] of Object.entries(fixture)) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), code);
    }
    const reports: Report[] = [];
    for (const [file, code] of Object.entries(fixture)) {
      if (/\.[cm]?[jt]sx?$/.test(file)) lintFile(rule, { code, dir, file, reports });
    }
    return reports;
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
}
