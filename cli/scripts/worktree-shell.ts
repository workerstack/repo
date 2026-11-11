import type path from "node:path";
import {
  ADD_CMD,
  ADD_VALUE_FLAGS,
  CD_WORD,
  CONFIG_FLAG,
  DETACH_FLAG,
  DETACH_SHORT,
  DIR_FLAG,
  GIT_BIN,
  HERE_STRING,
  HEREDOC,
  REASON_FLAG,
  WORKTREE_SUB,
} from "./worktree.constants.ts";
import type { GitCommand, Heredoc, ShellLexer, Word, WorktreeAdd } from "./worktree.types.ts";

const HEREDOC_OP = /<<(?<dash>-?)[ \t]*(?:'(?<sq>[^'\n]*)'|"(?<dq>[^"\n]*)"|\\?(?<bare>[^\s;&|<>()'"\\]+))/y;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const PROXY = /^(?:.*\/)?(?:rtk|env)$/;

/** Push the heredoc the `<<` at `i` opens, if any; the index the scan goes on from. */
function heredocAt(line: string, i: number, opened: Heredoc[]): number {
  HEREDOC_OP.lastIndex = i;
  const m = HEREDOC_OP.exec(line);
  if (!m) return i + 1;
  const g = m.groups;
  opened.push({ word: String(g?.sq ?? g?.dq ?? g?.bare), indented: g?.dash === "-" });
  return i + m[0].length - 1;
}

/** The heredoc delimiters opened on one line, in order: `{ word, indented }`; a quoted `<<` or a `<<<` here-string opens none. */
function heredocsOpenedBy(line: string): Heredoc[] {
  const opened: Heredoc[] = [];
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (quote) quote = ch === quote ? "" : quote;
    else if (ch === "\\") i++;
    else if (ch === "'" || ch === '"') quote = ch;
    else if (line.startsWith(HERE_STRING, i)) i += HERE_STRING.length - 1;
    else if (line.startsWith(HEREDOC, i)) i = heredocAt(line, i, opened);
  }
  return opened;
}

/** `command` without heredoc bodies and their terminator lines: they are data, not commands. */
function dropHeredocBodies(command: unknown): string {
  const kept: string[] = [];
  let pending: Heredoc[] = [];
  for (const line of String(command).split("\n")) {
    const [open] = pending;
    if (open) {
      const bare = line.replace(/\r$/, "");
      if ((open.indented ? bare.replace(/^\t+/, "") : bare) === open.word) pending.shift();
      continue;
    }
    kept.push(line);
    pending = heredocsOpenedBy(line);
  }
  return kept.join("\n");
}

function endWord(lx: ShellLexer): void {
  if (lx.word) lx.seg.push(lx.word);
  lx.word = null;
}

function addText(lx: ShellLexer, text: string, literal = true): void {
  lx.word = lx.word || { text: "", literal: true };
  lx.word.text += text;
  if (!literal) lx.word.literal = false;
}

/** The text of the quote opening at `lx.i`, to its close or the end; moves `lx.i` onto the close. */
function quoted(lx: ShellLexer, q: string): string {
  const close = lx.s.indexOf(q, lx.i + 1);
  const inner = close < 0 ? lx.s.slice(lx.i + 1) : lx.s.slice(lx.i + 1, close);
  lx.i = close < 0 ? lx.s.length : close;
  return inner;
}

function endSegment(lx: ShellLexer): void {
  endWord(lx);
  if (!lx.seg.length) return;
  lx.seg = [];
  lx.segments.push(lx.seg);
}

function plain(lx: ShellLexer, ch: string): void {
  addText(lx, ch, !(ch === "$" || ch === "`" || (ch === "~" && !lx.word)));
}

function step(lx: ShellLexer, ch: string): void {
  if (" \t".includes(ch)) endWord(lx);
  else if (";&|\n".includes(ch)) endSegment(lx);
  else if (ch === "'") addText(lx, quoted(lx, ch));
  else if (ch === '"') {
    const inner = quoted(lx, ch);
    addText(lx, inner, !/[$`\\]/.test(inner));
  } else if (ch === "\\") {
    addText(lx, lx.s.charAt(lx.i + 1));
    lx.i++;
  } else plain(lx, ch);
}

/** Shell words per command segment; a word holding `$`, a backtick or a leading `~` is not literal. */
function shellSegments(command: unknown): Word[][] {
  const seg: Word[] = [];
  const lx: ShellLexer = { s: dropHeredocBodies(command), i: 0, segments: [seg], seg, word: null };
  for (; lx.i < lx.s.length; lx.i++) step(lx, lx.s.charAt(lx.i));
  endWord(lx);
  return lx.segments.filter((words) => words.length);
}

/** The git command after git's own options; null when none follows or a `-C` dir is not literal. */
function afterOptions(words: Word[], at: string, p: typeof path): GitCommand | null {
  const [opt, value, ...more] = words;
  if (!opt) return null;
  if (!opt.text.startsWith("-")) return { at, sub: opt.text, rest: words.slice(1) };
  if (opt.text === DIR_FLAG) return value?.literal ? afterOptions(more, p.resolve(at, value.text), p) : null;
  return afterOptions(opt.text === CONFIG_FLAG ? more : words.slice(1), at, p);
}

/** `{ at, sub, rest }` for a `[VAR=v] [rtk] [env VAR=v] git [-C dir] [-c k=v] <sub> …` segment; null for any other, or when a `-C` dir is not literal. */
function gitCommandOf(words: Word[], cwd: string, p: typeof path): GitCommand | null {
  // `FOO=1`, `env FOO=1` and the `rtk` proxy all stand before the real command.
  const start = words.findIndex((w) => !ASSIGNMENT.test(w.text) && !PROXY.test(w.text));
  const [bin, ...after] = start < 0 ? [] : words.slice(start);
  if (!bin || (bin.text !== GIT_BIN && !bin.text.endsWith(`/${GIT_BIN}`))) return null;
  return afterOptions(after, cwd, p);
}

/** Each git command of a shell line with the dir it runs in, following `cd <literal>` between segments. */
export function* gitCommands(command: unknown, cwd: string, p: typeof path): Generator<GitCommand> {
  let here = cwd;
  for (const words of shellSegments(command)) {
    const [first, dir, extra] = words;
    if (first?.text === CD_WORD && dir?.literal && !extra) {
      here = p.resolve(here, dir.text);
      continue;
    }
    const g = gitCommandOf(words, here, p);
    if (g) yield g;
  }
}

/** Fold one word of a `git worktree add` into `out`; a flag that takes a value takes the next word. */
function addArg(out: WorktreeAdd, w: Word, words: Iterator<Word>): void {
  if (ADD_VALUE_FLAGS.includes(w.text)) {
    const value = words.next();
    if (w.text !== REASON_FLAG) out.branch = value.done ? null : value.value.text;
  } else if (w.text === DETACH_FLAG || w.text === DETACH_SHORT) out.detach = true;
  else if (w.text.startsWith("-")) return;
  else if (!out.target) out.target = w;
  else if (!out.commitish) out.commitish = w.text;
}

/** `{ at, target, branch, commitish, detach }` for a `git … worktree add …` command, else null. */
export function worktreeAddOf(g: GitCommand): WorktreeAdd | null {
  const [first, ...args] = g.rest;
  if (g.sub !== WORKTREE_SUB || first?.text !== ADD_CMD) return null;
  const out: WorktreeAdd = { at: g.at, target: null, branch: null, commitish: null, detach: false };
  const words = args[Symbol.iterator]();
  for (const w of words) addArg(out, w, words);
  return out;
}
