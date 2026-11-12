/**
 * Runs an oxlint JS plugin rule in process, the way oxlint hands it each file, over fixture files written to a temp
 * dir. oxlint's own `RuleTester` refuses Bun, so this parses with `oxc-parser`, oxlint's parser. Rules are typed
 * against `RuleContext` (cli/lint/rule.types.ts), so the context built here is whole and tsc fails if a rule reads
 * anything else; `cli/scripts/lint.test.ts` still runs each rule through real oxlint.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseSync, type Program } from "oxc-parser";

import type { RepoRule, RuleComment, RuleContext } from "../cli/lint/rule.types.ts";
import { PARENT_KEY } from "./parent-key.constants.ts";

/** The fixture files oxlint would lint: JS and TS, with or without JSX, in any module flavour. */
const LINTED_FILE = /\.[cm]?[jt]sx?$/;

/** Repo-relative path → source; package.json files among them are read by rules that read manifests. */
export type Fixture = Record<string, string>;
/** One finding: the fixture path it is in and the rule's message. */
export type Report = { file: string; message: string };

type Span = { start: number; end: number };
type Node = { start: number; end: number; type: string; parent?: Node | null };
type Visitors = Record<string, ((node: never) => void) | undefined>;

/** The comments that touch `node` before it with only whitespace between, as oxlint's `SourceCode` reports them. */
function commentsBefore(code: string, comments: readonly RuleComment[], node: Span): RuleComment[] {
  const out: RuleComment[] = [];
  let edge = node.start;
  for (const comment of comments.toReversed()) {
    if (comment.end > edge) continue;
    if (code.slice(comment.end, edge).trim() !== "") break;
    out.unshift(comment);
    edge = comment.start;
  }
  return out;
}

function commentsAfter(code: string, comments: readonly RuleComment[], node: Span): RuleComment[] {
  const out: RuleComment[] = [];
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

/** The whole `RuleContext` oxlint would give a rule for `code`, and the program it would walk. */
export function ruleContext(input: {
  cwd: string;
  filename: string;
  code: string;
  options: RuleContext["options"];
  report: RuleContext["report"];
}): { context: RuleContext; program: Program } {
  const { cwd, filename, code, options, report } = input;
  const parsed = parseSync(filename, code, { preserveParens: false });
  const comments: readonly RuleComment[] = parsed.comments.map((comment) => ({
    ...comment,
    range: [comment.start, comment.end],
  }));
  const sourceCode = {
    getAllComments: () => comments,
    getCommentsAfter: (node: Span) => commentsAfter(code, comments, node),
    getCommentsBefore: (node: Span) => commentsBefore(code, comments, node),
    text: code,
  };
  return { context: { cwd, filename, options, report, sourceCode }, program: parsed.program };
}

type Lint = { dir: string; file: string; code: string; options: RuleContext["options"]; reports: Report[] };

function lintFile(rule: Pick<RepoRule, "create">, { dir, file, code, options, reports }: Lint): void {
  const { context, program } = ruleContext({
    code,
    cwd: dir,
    filename: path.join(dir, file),
    options,
    report: ({ message }) => reports.push({ file, message: message ?? "" }),
  });
  const visitors = rule.create(context) /* create returns the visitor map oxlint calls by node type */ as Visitors;
  visitAll(program, visitors);
}

/**
 * What `rule` reports over every `.ts` file of `fixture`, in fixture order; the temp dir is gone after. `options` is
 * the rule's `context.options`, as oxlint hands over what follows `"error"` in `["error", {…}]`.
 */
export function reportsOf(
  rule: Pick<RepoRule, "create">,
  fixture: Fixture,
  options: RuleContext["options"] = [],
): Report[] {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-rule-")));
  try {
    for (const [file, code] of Object.entries(fixture)) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), code);
    }
    const reports: Report[] = [];
    for (const [file, code] of Object.entries(fixture))
      if (LINTED_FILE.test(file)) lintFile(rule, { code, dir, file, options, reports });

    return reports;
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
}
