/**
 * Redundant nested `.gitignore` writes (roadmap D4): a nested write is redundant when every literal line it adds
 * is already ignored by the parent `.gitignore` files alone. The gate denies those; everything unclear passes.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalPath } from "./workspace-root.ts";
import { childEnv } from "../env.ts";

/** One `.gitignore` write: the file and the literal lines it would add. */
export interface IgnoreEdit {
  file: string;
  added: string[];
}

/** A tool call's argument bag; the shape varies per host and tool, so every field is read with a guard. */
type ToolArgs = Record<string, unknown>;

/** A shell write of literal text to one file. */
interface ShellWrite {
  file: string;
  append: boolean;
  text: string | null;
}

/** One word or one `>`, `>>`, `|` operator of a parsed shell line. */
interface ShellToken {
  word?: string;
  op?: string;
}

/** An added line that a parent `.gitignore` already ignores, with the rule that covers it. */
export interface RedundantLine {
  line: string;
  rule: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Inherited repo pointers that would aim git at another repo. */
const GIT_ENV_DROP = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_CEILING_DIRECTORIES"];
/** An unanchored line is checked one level deeper too, where a top-anchored parent rule stops matching. */
const PROBE_DIR = ".workerstack-probe";

function runGit(git: string, args: string[], cwd: string) {
  const env = childEnv();
  for (const k of GIT_ENV_DROP) delete env[k];
  return spawnSync(git, args, { cwd, env, encoding: "utf8" });
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function linesOf(text: unknown): string[] {
  return String(text).split(/\r?\n/);
}

/** @returns the candidate lines the file does not hold yet, minus blanks and comments */
function ignoreEdit(file: string, candidates: string[]): IgnoreEdit {
  const have = new Set(linesOf(readText(file)).map((l) => l.trimEnd()));
  const added: string[] = [];
  for (const raw of candidates) {
    const line = raw.trimEnd();
    if (!line || line.startsWith("#") || have.has(line) || added.includes(line)) continue;
    added.push(line);
  }
  return { file, added };
}

/** Apply the host's search/replace to `text`; null when an old string is missing (the host then fails the edit). */
export function projectEdit(text: string, args: ToolArgs): string | null {
  const edits: unknown[] = Array.isArray(args.edits) ? args.edits : [args];
  let next = text;
  for (const edit of edits) {
    const e: ToolArgs = isRecord(edit) ? edit : {};
    const oldStr = [e.old_string, e.oldString, e.Target].find((v) => typeof v === "string");
    const newStr = [e.new_string, e.newString, e.Replacement].find((v) => typeof v === "string");
    if (typeof oldStr !== "string" || typeof newStr !== "string" || !next.includes(oldStr)) return null;
    next = e.replace_all || e.replaceAll ? next.split(oldStr).join(newStr) : next.replace(oldStr, () => newStr);
  }
  return next;
}

/** The absolute target when `raw` names a `.gitignore`, else null. */
export function ignoreTarget(raw: unknown, cwd: string, p: typeof path = path): string | null {
  if (typeof raw !== "string" || !raw) return null;
  const abs = canonicalPath(p.resolve(cwd, raw), p);
  return p.basename(abs) === ".gitignore" ? abs : null;
}

/** The edit a Write or search/replace call makes to a `.gitignore` named in one of `fields`. */
export function writeIgnoreEdits(args: ToolArgs, cwd: string, fields: readonly string[]): IgnoreEdit[] {
  for (const key of fields) {
    const file = ignoreTarget(args[key], cwd);
    if (!file) continue;
    const full = [args.content, args.Content].find((v) => typeof v === "string");
    const next = full ?? projectEdit(readText(file), args);
    return next == null ? [] : [ignoreEdit(file, linesOf(next))];
  }
  return [];
}

/** Each `.gitignore` a Codex patch adds or updates, with its `+` lines. */
export function patchIgnoreEdits(patch: string, cwd: string): IgnoreEdit[] {
  const sections: { raw: string; plus: string[] }[] = [];
  let cur: { raw: string; plus: string[] } | null = null;
  for (const line of linesOf(patch)) {
    const m = /^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/.exec(line);
    if (m) {
      if (m[1] === "Move to") {
        if (cur) cur.raw = m[2]!.trim(); // group 2 always matches
      } else {
        cur = m[1] === "Delete File" ? null : { raw: m[2]!.trim(), plus: [] };
        if (cur) sections.push(cur);
      }
      continue;
    }
    if (cur && line.startsWith("+")) cur.plus.push(line.slice(1));
  }
  const out: IgnoreEdit[] = [];
  for (const s of sections) {
    const file = ignoreTarget(s.raw, cwd);
    if (file) out.push(ignoreEdit(file, s.plus));
  }
  return out;
}

const UNSAFE_CHAR = /[;&$`(){}<*?[\]\\#~!]/;

/** Words and `>`/`>>`/`|` of one shell line; null on anything a plain parse cannot read literally. */
function shellTokens(line: string): ShellToken[] | null {
  const out: ShellToken[] = [];
  let word: string | null = null;
  const end = () => {
    if (word != null) out.push({ word });
    word = null;
  };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!; // i < line.length
    if (ch === " " || ch === "\t") end();
    else if (ch === ">") {
      end();
      const append = line[i + 1] === ">";
      if (append) i++;
      out.push({ op: append ? ">>" : ">" });
    } else if (ch === "|") {
      if (line[i + 1] === "|") return null;
      end();
      out.push({ op: "|" });
    } else if (ch === "'" || ch === '"') {
      const close = line.indexOf(ch, i + 1);
      if (close === -1) return null;
      const inner = line.slice(i + 1, close);
      if (ch === '"' && /[$`\\]/.test(inner)) return null;
      word = (word ?? "") + inner;
      i = close;
    } else if (UNSAFE_CHAR.test(ch)) return null;
    else word = (word ?? "") + ch;
  }
  end();
  return out;
}

function unescape(s: string): string {
  return s.replace(/\\(.)/g, (_: string, c: string) => (c === "n" ? "\n" : c === "t" ? "\t" : c));
}

/** The text `echo` or `printf` prints, or null when it depends on anything but its literal words. */
function producedText(words: string[]): string | null {
  const [cmd, ...args] = words;
  if (cmd === "printf") {
    if (args.length !== 1 || /%/.test(args[0]!.replace(/%%/g, ""))) return null;
    return unescape(args[0]!.replace(/%%/g, "%")); // length is 1
  }
  if (cmd !== "echo") return null;
  let newline = true;
  let escapes = false;
  while (/^-[neE]+$/.test(args[0] || "")) {
    const flag = args.shift()!; // the loop test saw args[0]
    if (flag.includes("n")) newline = false;
    if (flag.includes("e")) escapes = true;
  }
  const body = args.join(" ");
  if (!escapes && body.includes("\\")) return null;
  return (escapes ? unescape(body) : body) + (newline ? "\n" : "");
}

/** `tee [-a] FILE [> /dev/null]` at `tokens`; null when the tokens are anything else. */
function teeTarget(tokens: ShellToken[]): { file: string; append: boolean } | null {
  const t = tokens.slice();
  if (t.shift()?.word !== "tee") return null;
  let append = false;
  if (t[0]?.word === "-a") {
    append = true;
    t.shift();
  }
  const file = t.shift()?.word;
  if (!file) return null;
  if (t.length && !(t.length === 2 && t[0]!.op === ">" && t[1]!.word === "/dev/null")) return null;
  return { file, append };
}

/** One shell write of literal text to one file, in the forms D4 names; null for every other command. */
function shellIgnoreWrite(command: unknown): ShellWrite | null {
  const lines = String(command).replace(/\s+$/, "").split("\n");
  let head = lines[0]!; // split always yields one element
  let body: string | null = null;
  const doc = /<<(-?)\s*(['"]?)(\w+)\2/.exec(head);
  if (doc) {
    const last = lines.length - 1;
    const strip = (l: string) => (doc[1] ? l.replace(/^\t+/, "") : l);
    if (last < 1 || strip(lines[last]!).trim() !== doc[3]) return null;
    const bodyLines = lines.slice(1, last).map(strip);
    if (!doc[2] && bodyLines.some((l: string) => /[$`\\]/.test(l))) return null;
    body = bodyLines.map((l) => `${l}\n`).join("");
    head = head.slice(0, doc.index) + " " + head.slice(doc.index + doc[0].length);
  } else if (lines.length > 1) return null;
  const tokens = shellTokens(head);
  if (!tokens || !tokens.length) return null;
  const pipe = tokens.findIndex((t) => t.op === "|");
  const redirect = tokens.findIndex((t) => t.op === ">" || t.op === ">>");
  const producer = tokens.slice(0, pipe === -1 ? (redirect === -1 ? tokens.length : redirect) : pipe);
  if (producer.some((t) => t.op)) return null;
  const words = producer.map((t) => t.word /* no operators remain in producer */ as string);
  if (words[0] === "tee") {
    const tee = body == null ? null : teeTarget(tokens);
    return tee && { ...tee, text: body };
  }
  const text = words[0] === "cat" ? (words.length === 1 ? body : null) : body == null ? producedText(words) : null;
  if (text == null) return null;
  if (pipe !== -1) {
    const tee = teeTarget(tokens.slice(pipe + 1));
    return tee && { ...tee, text };
  }
  const rest = tokens.slice(redirect);
  if (redirect === -1 || rest.length !== 2 || !rest[1]?.word) return null;
  return { file: rest[1].word, append: rest[0]?.op === ">>", text };
}

/** The edit a simple shell redirect makes to a `.gitignore`; [] for every other command. */
export function shellIgnoreEdits(command: unknown, cwd: string): IgnoreEdit[] {
  const w = shellIgnoreWrite(command);
  const file = w && ignoreTarget(w.file, cwd);
  return file ? [ignoreEdit(file, linesOf(w.text))] : [];
}

/** Paths, relative to `top` with `/`, of the `.gitignore` in each directory above the target, from `top` down. */
export function parentIgnoreFiles(file: string, top: string, p: typeof path = path): string[] {
  const rel = p.relative(p.resolve(top), p.dirname(file));
  if (!rel || rel.startsWith("..") || p.isAbsolute(rel)) return [];
  const parts = rel.split(p.sep);
  return parts.map((_, i) => [...parts.slice(0, i), ".gitignore"].join("/"));
}

function nearestDir(file: string): string {
  let dir = path.dirname(file);
  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  return dir;
}

function topOf(file: string, git: string): string | null {
  const r = runGit(git, ["rev-parse", "--show-toplevel"], nearestDir(file));
  return r.status === 0 ? canonicalPath(path.resolve(r.stdout.trim())) : null;
}

/**
 * The added lines of a nested `.gitignore` that its parent `.gitignore` files alone already ignore, each with the
 * covering rule; [] unless every added line is literal and covered.
 * @returns
 */
export function redundantIgnoreLines(
  target: string,
  added: string[],
  { git = "git" }: { git?: string } = {},
): RedundantLine[] {
  const lines = added.map((l) => l.trimEnd()).filter((l) => l && !l.startsWith("#"));
  if (!lines.length || lines.some((l) => l.startsWith("!") || /[*?[\\]/.test(l))) return [];
  const file = canonicalPath(path.resolve(target));
  const top = topOf(file, git);
  const parents = top ? parentIgnoreFiles(file, top) : [];
  if (!top || !parents.length) return [];
  const dir = path.relative(top, path.dirname(file)).split(path.sep).join("/");
  const probes = lines.map((l) => {
    const anchored = l.replace(/\/$/, "").includes("/");
    const body = l.replace(/^\//, "");
    return anchored ? [`${dir}/${body}`] : [`${dir}/${body}`, `${dir}/${PROBE_DIR}/${body}`];
  });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repo-ignore-"));
  try {
    if (runGit(git, ["init", "-q", "--template="], tmp).status !== 0) return [];
    for (const rel of parents) {
      const src = path.join(top, ...rel.split("/"));
      if (!fs.existsSync(src)) continue;
      const dest = path.join(tmp, ...rel.split("/"));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
    const r = runGit(
      git,
      ["-c", "core.excludesFile=", "check-ignore", "--no-index", "-v", "--non-matching", "--", ...probes.flat()],
      tmp,
    );
    if (r.status !== 0 && r.status !== 1) return [];
    const hits = new Map<string, { source: string; n: string; pattern: string }>();
    for (const row of r.stdout.split("\n")) {
      const m = /^(.*?):(\d*):(.*)\t(.*)$/.exec(row);
      if (m && m[1] && !m[3]!.startsWith("!")) hits.set(m[4]!, { source: m[1], n: m[2]!, pattern: m[3]! }); // groups 2-4 always match
    }
    if (!probes.every((ps) => ps.every((q) => hits.has(q)))) return [];
    return lines.map((line, i) => {
      // Every probe is in hits (checked above) and probes has one entry per line.
      const h = hits.get(probes[i]![0]!)!;
      return { line, rule: `${path.join(top, ...h.source.split("/"))}:${h.n} ${h.pattern}` };
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** The deny reason for the first edit whose added lines are all redundant, else null. */
export function redundantIgnoreReason(edits: IgnoreEdit[]): string | null {
  for (const e of edits) {
    const hits = e.added.length ? redundantIgnoreLines(e.file, e.added) : [];
    if (!hits.length) continue;
    const items = hits.map((h) => `"${h.line}" (ignored by ${h.rule})`).join(", ");
    return `redundant .gitignore lines in ${e.file}: ${items}. Leave them out; the parent rules already ignore them`;
  }
  return null;
}
