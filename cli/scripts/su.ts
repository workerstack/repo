#!/usr/bin/env bun
/** Su: one line per plan and roadmap of a session, or of a time window, with leaf boxes and blockers. */
import fs from "node:fs";
import path from "node:path";

import { repoPath } from "../repo-dirs.ts";
import { MD_EXT } from "./clean.constants.ts";
import { approvalsPath, frontmatterOf, readLines } from "./orchestrate-session.ts";
import { ITEM_KIND_LIST, ITEM_KINDS, PLAN_KIND } from "./orchestrate.constants.ts";
import { BOX_RE } from "./persist-plan.constants.ts";
import {
  badWindow,
  BLOCKERS_HEADING,
  BULLET_RE,
  COMMIT_FORMAT,
  EXIT_USAGE,
  FLAG_PREFIX,
  HEADING_RE,
  IMPLEMENTATIONS_DIR,
  LINE_BREAK_RE,
  MD_SUFFIX_RE,
  MINUTE_CHARS,
  MS_PER_SECOND,
  NO_BLOCKER,
  NO_GROUPS,
  NOT_FOUND,
  noSessionItems,
  OVERNIGHT,
  OVERNIGHT_HOURS,
  SESSION_FLAG,
  UNIT_MS,
  UNKNOWN,
  USAGE,
  WINDOW_RE,
  type Unit,
} from "./su.constants.ts";
import { resolveRoots, type Roots } from "./workspace-root.ts";
import { defaultBranch, git } from "./worktree-git.ts";

/** A window's length in ms and the text the header shows for it. */
type Window = { ms: number; label: string };

/** What the command line asks for; a window wins over a session. */
type Request = { kind: "session"; sid: string } | { kind: "window"; window: Window };

/** The request, or the exit code and message of the refusal. */
type Parsed = { ok: true; request: Request } | { ok: false; message: string; code: number };

/** A plan or roadmap file and its kind, as `plan` or `fast roadmap`. */
type Item = { file: string; kind: string };

/** The kind of each work dir, as `fast plan`. */
function kindByDir(): Map<string, string> {
  return new Map(ITEM_KIND_LIST.map((k) => [ITEM_KINDS[k].dir, k.replace("-", " ")]));
}

function write(msg: string, stream: NodeJS.WriteStream = process.stdout): void {
  stream.write(`${msg}\n`);
}

/** The window an argument names, or null. */
function windowOf(arg: string): Window | null {
  if (arg === OVERNIGHT) return { label: arg, ms: OVERNIGHT_HOURS * UNIT_MS.h };
  const hit = WINDOW_RE.exec(arg);

  if (hit === null) return null;
  const [, count, unit] = hit;

  return { label: arg, ms: Number(count) * UNIT_MS[unit /* the regex allows m, h and d only */ as Unit] };
}

/** The CLI boundary: flags and the window text become a request, or a refusal. */
function parse(argv: readonly string[]): Parsed {
  const usage = { code: EXIT_USAGE, message: USAGE, ok: false } as const;
  const at = argv.indexOf(SESSION_FLAG);
  const sid = at === NOT_FOUND ? null : (argv[at + 1] ?? null);
  const rest = argv.filter((_, i) => at === NOT_FOUND || (i !== at && i !== at + 1));
  const [arg] = rest;

  const stray = rest.length > 1 || rest.some((a) => a.startsWith(FLAG_PREFIX));

  if ((at !== NOT_FOUND && sid === null) || stray) return usage;

  if (arg === undefined) return sid === null ? usage : { ok: true, request: { kind: "session", sid } };
  const window = windowOf(arg);

  return window === null
    ? { code: EXIT_USAGE, message: badWindow(arg), ok: false }
    : { ok: true, request: { kind: "window", window } };
}

/** The session's saved items in save order; a file that is gone or outside the four work dirs is skipped. */
function sessionItems(root: string, sid: string): Item[] {
  const kinds = kindByDir();

  return readLines(approvalsPath(root, sid)).flatMap((file) => {
    const kind = kinds.get(path.basename(path.dirname(file)));

    return kind === undefined || !fs.existsSync(file) ? [] : [{ file, kind }];
  });
}

/** Every item whose file changed at or after `start`, newest first. */
function windowItems(root: string, start: number): Item[] {
  return [...kindByDir()]
    .flatMap(([dir, kind]) => {
      const base = repoPath(root, dir);
      const names = fs.existsSync(base) ? fs.readdirSync(base).filter((n) => n.endsWith(MD_EXT)) : [];

      return names.map((n) => ({ file: path.join(base, n), kind, mtime: fs.statSync(path.join(base, n)).mtimeMs }));
    })
    .filter((i) => i.mtime >= start)
    .toSorted((a, b) => b.mtime - a.mtime)
    .map(({ file, kind }) => ({ file, kind }));
}

/** Leaf boxes done and in all: a box is a leaf when the next box is not one of its children. */
function leafCounts(text: string) {
  const boxes = text.split(LINE_BREAK_RE).flatMap((line) => {
    const { id, mark } = BOX_RE.exec(line)?.groups ?? NO_GROUPS;

    return id === undefined ? [] : [{ done: mark !== " ", id }];
  });

  const leaves = boxes.filter((b, i) => !(boxes[i + 1]?.id.startsWith(`${b.id}.`) ?? false));

  return { done: leaves.filter((b) => b.done).length, total: leaves.length };
}

/** The bullets under `## Blockers` of a journal, without `(none)`. */
function blockersOf(text: string): string[] {
  const lines = text.split(LINE_BREAK_RE);
  const from = lines.indexOf(BLOCKERS_HEADING) + 1;

  if (from === 0) return [];
  const rest = lines.slice(from);
  const end = rest.findIndex((l) => HEADING_RE.test(l));

  return (end === NOT_FOUND ? rest : rest.slice(0, end)).flatMap((l) => {
    const [, bullet] = BULLET_RE.exec(l) ?? [];

    return bullet === undefined || bullet === NO_BLOCKER ? [] : [bullet];
  });
}

/** The blockers of each plan's journal, by the plan's serial. */
function blockersBySerial(root: string): Map<string, string[]> {
  const dir = repoPath(root, IMPLEMENTATIONS_DIR);
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(MD_EXT)) : [];
  const found = new Map<string, string[]>();

  for (const n of names) {
    const text = fs.readFileSync(path.join(dir, n), "utf8");
    const plan = frontmatterOf(text)["plan"];

    if (plan !== undefined) found.set(plan, [...(found.get(plan) ?? []), ...blockersOf(text)]);
  }

  return found;
}

function orElse(value: string | undefined, fallback: string): string {
  return value === undefined || value === "" ? fallback : value;
}

function lineOf(item: Item, blockers: ReadonlyMap<string, string[]>): string {
  const text = fs.readFileSync(item.file, "utf8");
  const fm = frontmatterOf(text);
  const serial = orElse(fm["serial"], UNKNOWN);
  const name = orElse(fm["name"], path.basename(item.file).replace(MD_SUFFIX_RE, ""));
  const { done, total } = leafCounts(text);
  const stuck = item.kind === PLAN_KIND ? (blockers.get(serial) ?? []) : [];
  const tail = stuck.map((b) => `; blocker: ${b}`).join("");

  return `${item.kind} ${serial} ${name}: ${orElse(fm["status"], UNKNOWN)}, ${done} of ${total} boxes${tail}`;
}

/** The default branch's commits since `start`; none outside a repo or when git fails. */
function commitLines(root: string, start: number): string[] {
  const since = `--since=@${Math.floor(start / MS_PER_SECOND)}`;
  const log = git(root, ["log", since, COMMIT_FORMAT, defaultBranch(root), "--"]);

  return log.ok && log.out !== "" ? log.out.split(LINE_BREAK_RE).map((l) => `commit ${l}`) : [];
}

function sessionReport(root: string, sid: string): void {
  const items = sessionItems(root, sid);
  const blockers = blockersBySerial(root);

  if (items.length === 0) write(noSessionItems(sid));

  for (const item of items) write(lineOf(item, blockers));
}

function windowReport(root: string, now: number, window: Window): void {
  const start = now - window.ms;
  const head = `since ${new Date(start).toISOString().slice(0, MINUTE_CHARS)}Z (${window.label}):`;
  const blockers = blockersBySerial(root);
  const lines = [...windowItems(root, start).map((i) => lineOf(i, blockers)), ...commitLines(root, start)];

  write(lines.length === 0 ? `${head} nothing changed` : [head, ...lines].join("\n"));
}

/** `now` is the clock in ms, a parameter so a test fixes the window's start. */
export function main(argv: string[], roots: () => Roots = resolveRoots, now: number = Date.now()): number {
  const parsed = parse(argv);

  if (!parsed.ok) {
    write(parsed.message, process.stderr);

    return parsed.code;
  }

  try {
    const { root } = roots();
    const { request } = parsed;

    if (request.kind === "session") sessionReport(root, request.sid);
    else windowReport(root, now, request.window);

    return 0;
  } catch (err) {
    write((err /* fs and the roots lookup throw Errors */ as Error).message, process.stderr);

    return 1;
  }
}
