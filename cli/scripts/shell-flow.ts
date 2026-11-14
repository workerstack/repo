/**
 * Walks a shell command the way bash runs it and hands each simple command, with the dir it runs in, to a visitor:
 * the commands of substitutions, blocks, branches, loops, functions and every script a command makes bash run.
 */
import type path from "node:path";

import { cdEffect } from "./cd-effect.ts";
import type { Dir, ShellNode, ShellWord, Simple, StartEnv, Stdin, Vars, Visited } from "./shell-ast.types.ts";
import { expandWord } from "./shell-expand.ts";
import { scriptText } from "./shell-lex-word.ts";
import { lex } from "./shell-lex.ts";
import { shellParse } from "./shell-parse.ts";
import { pipedStdin, programAt, redirectStdin, scriptsOf } from "./shell-scripts.ts";
import { joinVars, sameVars, seedVars, varsAfter, withDir, withVar } from "./shell-vars.ts";

/**
 * Where a walk stands: the dir, the variables, the functions defined so far, the calls being walked (to stop
 * recursion), and what the commands here read on stdin.
 */
type State = { dir: Dir; vars: Vars; funcs: ReadonlyMap<string, ShellNode>; calls: readonly string[]; stdin: Stdin };

/** What stays fixed through a walk: the path module and the visitor. */
type Walker = { p: typeof path; visit: (v: Visited) => void };

/** Where a walk starts: the dir, the variables the shell starts with, and the path module that resolves dirs. */
export type FlowStart = { cwd: string; env: StartEnv; p: typeof path };

type Of<K extends ShellNode["kind"]> = Extract<ShellNode, { kind: K }>;

const NO_STDIN: Stdin = { kind: "none" };
const BLOCK_STDIN: Stdin = { cause: "a command block", kind: "opaque" };

/** The most a loop is walked: once, and again when the first pass moved the dir. */
const LOOP_PASSES = 2;

const BRANCH_CAUSE = "a folder set in a branch";

/** The most values a `for` list is walked with, one pass each. */
const MAX_FOR_VALUES = 8;

/** The characters an unquoted list word expands as a file pattern. */
const GLOB_RE = /[*?[]/;

const EMPTY: ShellNode = { items: [], kind: "seq" };

function sameDir(a: Dir, b: Dir): boolean {
  return a.known ? b.known && a.path === b.path : !b.known && a.cause === b.cause;
}

/**
 * The state after one of two branches ran: the dir and the variables both agree on, else unknown, and the functions
 * of both.
 */
function join(a: State, b: State): State {
  const dir: Dir = sameDir(a.dir, b.dir) ? a.dir : { cause: BRANCH_CAUSE, known: false };

  return { ...a, dir, funcs: new Map([...a.funcs, ...b.funcs]), vars: joinVars(a.vars, b.vars) };
}

/** `st` with nothing on stdin, as a substitution, a script or a function body starts. */
function unfed(st: State): State {
  return { ...st, stdin: NO_STDIN };
}

/** The scripts of every substitution in `word`, each walked in a copy of the state. */
function walkSubsts(w: Walker, word: ShellWord, st: State): void {
  const bodies = word.parts.flatMap((part) => {
    if (part.kind === "subst") return [part.body];

    return part.kind === "param" ? part.substs : [];
  });

  for (const body of bodies) walkNode(w, parse(body), unfed(st));
}

function wordsOf(c: Simple): ShellWord[] {
  return [...c.words, ...c.redirects.flatMap((r) => (r.body === undefined ? [r.target] : [r.target, r.body]))];
}

/**
 * The call of the defined function `c` names, which bash runs in place of a program or builtin of that name, walked
 * inline in the caller's state unless it is already being walked; null when `c` calls no defined function.
 */
function callOf(w: Walker, c: Simple, st: State): State | null {
  const word = c.words[programAt(c.words)];
  const name = word === undefined ? "" : scriptText(word);
  const body = st.funcs.get(name);

  if (body === undefined) return null;

  if (st.calls.includes(name)) return st;

  return { ...walkNode(w, body, { ...st, calls: [...st.calls, name] }), calls: st.calls };
}

/**
 * One simple command: its substitutions, itself, then the function it calls, else its scripts, its `cd` (which sets
 * `PWD`) and the variables it sets.
 */
function walkSimple(w: Walker, c: Simple, st: State): State {
  for (const word of wordsOf(c)) walkSubsts(w, word, st);
  w.visit({ ...c, dir: st.dir, vars: st.vars });

  if (c.data === true) return st;
  const called = callOf(w, c, st);

  if (called !== null) return called;
  let now = st;

  for (const s of scriptsOf(c, st.stdin)) {
    if (s.kind === "opaque") w.visit({ cause: s.cause, dir: now.dir, kind: "opaque" });
    else if (s.inherits) now = { ...walkNode(w, parse(s.text), unfed(now)), stdin: now.stdin };
    else walkNode(w, parse(s.text), unfed(now));
  }

  const dir = cdEffect(c.words, now, w.p);
  const moved = dir === null ? now : { ...now, dir, vars: withDir(now.vars, dir) };

  return { ...moved, vars: varsAfter(c, moved.vars) };
}

/** Each item of a pipe in a copy of the state, fed what the item before it writes. */
function walkPipe(w: Walker, node: Of<"pipe">, st: State): State {
  let { stdin } = st;

  for (const item of node.items) {
    walkNode(w, item, { ...st, stdin });
    stdin = item.kind === "simple" ? pipedStdin(item) : BLOCK_STDIN;
  }

  return st;
}

/**
 * A loop: its condition and body, again when the first pass moved the dir or changed a variable; it may end after any
 * condition.
 */
function walkLoop(w: Walker, node: Of<"loop">, st: State): State {
  let entry = st;

  for (let pass = 1; ; pass++) {
    const afterCond = walkNode(w, node.cond, entry);
    const again = join(entry, walkNode(w, node.body, afterCond));

    if (pass === LOOP_PASSES || (sameDir(again.dir, entry.dir) && sameVars(again.vars, entry.vars)))
      return join(afterCond, again);
    entry = again;
  }
}

function walkIf(w: Walker, node: Of<"if">, st: State): State {
  const afterCond = walkNode(w, node.cond, st);
  const otherwise = node.orElse === undefined ? afterCond : walkNode(w, node.orElse, afterCond);

  return join(walkNode(w, node.body, afterCond), otherwise);
}

function walkCase(w: Walker, node: Of<"case">, st: State): State {
  const afterWord = walkSimple(w, node.word, st);
  let got = afterWord;

  for (const arm of node.arms) got = join(got, walkNode(w, arm, afterWord));

  return got;
}

function walkSeq(w: Walker, node: Of<"seq">, st: State): State {
  let got = st;

  for (const item of node.items) got = walkNode(w, item, got);

  return got;
}

function walkOr(w: Walker, node: Of<"or">, st: State): State {
  const left = walkNode(w, node.left, st);

  return join(left, walkNode(w, node.right, left));
}

/**
 * A subshell or a command sent off with `&`: walked in a copy. A subshell right inside another may be `(( … ))`
 * arithmetic, which can assign, so it forgets every variable.
 */
function walkApart(w: Walker, node: Of<"async" | "subshell">, st: State): State {
  walkNode(w, node.body, st);

  return node.kind === "subshell" && node.body.kind === "subshell" ? { ...st, vars: new Map() } : st;
}

/** The values a `for` gives its name; null when one is unknown or a pattern, `select` picks, or there are too many. */
function forValues(node: Of<"for">, vars: Vars): string[] | null {
  if (node.select === true || node.words === null || node.words.words.length > MAX_FOR_VALUES) return null;
  const read = node.words.words.map((word) => expandWord(word, vars));

  return read.every((r) => r.literal && !GLOB_RE.test(r.raw)) ? read.map((r) => r.text) : null;
}

/**
 * A `for` or `select`: its list, then the body once per known value with the name set to it, in turn, any pass the
 * last; when the values are not known, a loop with the name unknown.
 */
function walkFor(w: Walker, node: Of<"for">, st: State): State {
  const entry = node.words === null ? st : walkSimple(w, node.words, st);
  const values = forValues(node, entry.vars);

  if (values === null) {
    const vars = withVar(entry.vars, node.name, { cause: `$${node.name}`, known: false });

    return walkLoop(w, { body: node.body, cond: EMPTY, kind: "loop" }, { ...entry, vars });
  }

  let pass = entry;
  let got = entry;

  for (const [i, text] of values.entries()) {
    pass = walkNode(w, node.body, { ...pass, vars: withVar(pass.vars, node.name, { known: true, text }) });
    got = i === 0 ? pass : join(got, pass);
  }

  return got;
}

/** A function definition: its body walked once in a copy, then its name defined. */
function walkFunc(w: Walker, node: Of<"func">, st: State): State {
  walkNode(w, node.body, unfed(st));

  return { ...st, funcs: new Map([...st.funcs, [node.name, node.body]]) };
}

/** Redirects written after a compound command: judged as a command of their own, the stdin they give fed in. */
function walkRedir(w: Walker, node: Of<"redir">, st: State): State {
  walkSimple(w, { kind: "simple", redirects: node.redirects, words: [] }, st);
  const after = walkNode(w, node.body, { ...st, stdin: redirectStdin(node.redirects, st.stdin) });

  return { ...after, stdin: st.stdin };
}

/** The walk of each node kind. */
const WALKS = {
  async: walkApart,
  case: walkCase,
  for: walkFor,
  func: walkFunc,
  if: walkIf,
  loop: walkLoop,
  or: walkOr,

  pipe: walkPipe,
  redir: walkRedir,
  seq: walkSeq,
  simple: walkSimple,
  subshell: walkApart,
} satisfies { [K in ShellNode["kind"]]: (w: Walker, node: Of<K>, st: State) => State };

function walkNode(w: Walker, node: ShellNode, st: State): State {
  const walkOf = WALKS[node.kind] /* the walk keyed by this node's own kind */ as (
    w: Walker,
    node: ShellNode,
    st: State,
  ) => State;

  return walkOf(w, node, st);
}

function parse(src: string): ShellNode {
  return shellParse(lex(src));
}

/** Walks `src` from `start.cwd`, handing `visit` each simple command bash would run and each script it cannot read. */
export function shellFlow(src: string, start: FlowStart, visit: (v: Visited) => void): void {
  const dir: Dir = { known: true, path: start.cwd };
  const st: State = { calls: [], dir, funcs: new Map(), stdin: NO_STDIN, vars: seedVars(start.env, start.cwd) };
  walkNode({ p: start.p, visit }, parse(src), st);
}
