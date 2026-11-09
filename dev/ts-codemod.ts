#!/usr/bin/env bun
// Converts the repo's `.mjs`/`.js` scripts to typed `.ts` run by bun, and annotates exports, in rerunnable passes:
//   runtime  `node <script>` becomes `bun <script>` and the shebangs follow
//   rename   git mv to `.ts`, rewrite every spelling of the names, turn JSDoc into types
//   move     stock sources to `agents/`, scripts to `cli/scripts/` (the default)
//   annotate the type codefix on each export isolatedDeclarations flags, over tsconfig.src.json
// Everything here uses `node:` APIs and `typescript` only, so vitest imports it under node.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export interface PassResult {
  changed: string[];
}

export interface RenameResult extends PassResult {
  /** Renamed files whose `@typedef` blocks the codefix left in place. */
  leftoverTypedefs: string[];
}

export interface AnnotateResult extends PassResult {
  /** The isolatedDeclarations errors the codefix left, as `file(line,col): TScode message`. */
  left: string[];
}

const RENAME_DIRS = ["bin/", "cli/", "dev/", ".rulesync/scripts/", ".grok/hooks/"];
const SKIP_TEXT = new Set(["bun.lock", "CHANGELOG.md"]);
const SCRIPT_EXT = /\.(mjs|js)$/;

function gitFiles(root: string): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
  return out.split("\0").filter(Boolean);
}

function renameSet(files: string[]): string[] {
  return files.filter((f) => SCRIPT_EXT.test(f) && RENAME_DIRS.some((d) => f.startsWith(d)));
}

function readText(root: string, rel: string): string | null {
  const abs = path.join(root, rel);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(abs);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const buf = fs.readFileSync(abs);
  if (buf.subarray(0, 8192).includes(0)) return null;
  return buf.toString("utf8");
}

function textFiles(files: string[]): string[] {
  return files.filter((f) => !SKIP_TEXT.has(f));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Rewrites every tracked text file through `fn`; returns the paths whose content changed. */
function rewriteAll(root: string, files: string[], fn: (text: string, rel: string) => string): string[] {
  const changed: string[] = [];
  for (const rel of textFiles(files)) {
    const text = readText(root, rel);
    if (text === null) continue;
    const next = fn(text, rel);
    if (next === text) continue;
    fs.writeFileSync(path.join(root, rel), next);
    changed.push(rel);
  }
  return changed;
}

export function runtimePass(root: string): PassResult {
  const files = gitFiles(root);
  const set = renameSet(files);
  if (set.length === 0) return { changed: [] };
  const names = [...new Set(set.map((f) => path.posix.basename(f)))].sort((a, b) => b.length - a.length);
  const invoke = new RegExp(
    `(?<![\\w./-])node(?=[ \\t]+(?:\\\\?["'])?(?:[^\\s"']*[\\\\/])?(?:${names.map(escapeRegExp).join("|")})(?![\\w-]|\\.\\w))`,
    "g",
  );
  const inSet = new Set(set);
  const changed = rewriteAll(root, files, (text, rel) => {
    let next = text.replace(invoke, "bun");
    if (inSet.has(rel)) next = next.replace(/^#!\/usr\/bin\/env node[ \t]*(?=\r?\n|$)/, "#!/usr/bin/env bun");
    return next;
  });
  return { changed: changed.sort() };
}

function globToRegExp(glob: string): RegExp {
  const body = [...glob].map((c) => (c === "*" ? ".*" : c === "?" ? "." : escapeRegExp(c))).join("");
  return new RegExp(`^${body}$`);
}

// A token may follow a regex `.` quantifier (`.*lessons\.ts`) but not start inside a dotted name.
const TOKEN = /(?<![\w*?-])(?<![\w*?-]\.)[\w*?-]+(?:\\?\.[\w*?-]+)*/g;
const TOKEN_EXT = /(\\?\.)(mjs|js)$/;

function rewriteSpellings(text: string, names: Set<string>): string {
  return text.replace(TOKEN, (token) => {
    const plain = token.replace(/\\\./g, ".");
    if (!SCRIPT_EXT.test(plain)) return token;
    const glob = /[*?]/.test(plain);
    // A glob needs a literal stem beside the wildcard (`persist-*.ts`); a bare `*.js` is never rewritten.
    if (glob && !/[^*?]/.test(plain.replace(SCRIPT_EXT, ""))) return token;
    const re = glob ? globToRegExp(plain) : null;
    const hit = re ? [...names].some((n) => re.test(n)) : names.has(plain);
    return hit ? token.replace(TOKEN_EXT, "$1ts") : token;
  });
}

function compilerOptions(root: string): ts.CompilerOptions {
  const cfg = path.join(root, "tsconfig.json");
  if (fs.existsSync(cfg)) {
    const read = ts.readConfigFile(cfg, ts.sys.readFile);
    if (!read.error) {
      return { ...ts.parseJsonConfigFileContent(read.config, ts.sys, root).options, noEmit: true };
    }
  }
  return {
    strict: true,
    noEmit: true,
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    allowImportingTsExtensions: true,
    skipLibCheck: true,
    noUncheckedIndexedAccess: true,
    types: [],
  };
}

interface Span {
  start: number;
  end: number;
}

/** Moves `spans` for an edit that replaced [start, end) by `newLength` characters, then records the new text. */
function trackEdit(spans: Span[], start: number, end: number, newLength: number): void {
  const delta = newLength - (end - start);
  for (const s of spans) {
    if (s.start >= end) {
      s.start += delta;
      s.end += delta;
    } else if (s.end > start) {
      s.start = Math.min(s.start, start);
      s.end = Math.max(s.end, end) + delta;
    }
  }
  spans.push({ start, end: start + newLength });
}

function mergeSpans(spans: Span[]): Span[] {
  const sorted = spans.map((s) => ({ ...s })).sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push(s);
  }
  return out;
}

function applyTextChanges(text: string, edits: readonly ts.TextChange[], spans: Span[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.span.start - a.span.start)) {
    const end = e.span.start + e.span.length;
    out = out.slice(0, e.span.start) + e.newText + out.slice(end);
    trackEdit(spans, e.span.start, end, e.newText.length);
  }
  return out;
}

/** A language service over some files, the spans each codefix changed in them, and a way to mark a file rewritten. */
interface Fixer {
  service: ts.LanguageService;
  files: string[];
  spansByFile: Map<string, Span[]>;
  bump: (file: string) => void;
}

/** A fixer over `absFiles`, keyed by forward-slash names, which is how the language service reports changes. */
function fixerFor(root: string, absFiles: string[], options: ts.CompilerOptions): Fixer {
  const files = absFiles.map((f) => f.split(path.sep).join("/"));
  const versions = new Map(files.map((f) => [f, 0]));
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => files,
    getScriptVersion: (f) => String(versions.get(f) ?? 0),
    getScriptSnapshot: (f) => (fs.existsSync(f) ? ts.ScriptSnapshot.fromString(fs.readFileSync(f, "utf8")) : undefined),
    getCurrentDirectory: () => root,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  const bump = (f: string) => versions.set(f, (versions.get(f) ?? 0) + 1);
  const spansByFile = new Map<string, Span[]>(files.map((f) => [f, []]));
  return { service: ts.createLanguageService(host), files, spansByFile, bump };
}

/** Writes `changes` to the fixer's files, recording their spans; true when any file changed. */
function applyChanges({ spansByFile, bump }: Fixer, changes: readonly ts.FileTextChanges[]): boolean {
  let applied = false;
  for (const change of changes) {
    const spans = spansByFile.get(change.fileName);
    if (!spans || change.textChanges.length === 0) continue;
    const text = fs.readFileSync(change.fileName, "utf8");
    fs.writeFileSync(change.fileName, applyTextChanges(text, change.textChanges, spans));
    bump(change.fileName);
    applied = true;
  }
  return applied;
}

/** Applies the combined codefix `fixId` file by file; true when it changed any file. */
function applyFix(fixer: Fixer, fixId: string): boolean {
  let applied = false;
  for (const file of fixer.files) {
    const fix = fixer.service.getCombinedCodeFix({ type: "file", fileName: file }, fixId, {}, {});
    applied = applyChanges(fixer, fix.changes) || applied;
  }
  return applied;
}

/** Applies codefix `fixName` at the first error that offers it, for a fix TypeScript cannot apply file-wide. */
function applyFirstFix(fixer: Fixer, fixName: string): boolean {
  for (const file of fixer.files) {
    for (const d of fixer.service.getSemanticDiagnostics(file)) {
      const start = d.start ?? 0;
      const end = start + (d.length ?? 0);
      const fixes = fixer.service.getCodeFixesAtPosition(file, start, end, [d.code], {}, {});
      const fix = fixes.find((offered) => offered.fixName === fixName);
      if (fix) return applyChanges(fixer, fix.changes);
    }
  }
  return false;
}

/** Applies the JSDoc codefixes to `files` (absolute paths), then formats only the spans they changed. */
function convertJsDoc(root: string, absFiles: string[]): void {
  if (absFiles.length === 0) return;
  const fixer = fixerFor(root, absFiles, compilerOptions(root));
  for (const fixId of ["convertTypedefToType", "annotateWithTypeFromJSDoc"]) applyFix(fixer, fixId);
  formatSpans(fixer);
}

/** Formats, with the language service, only the spans the codefixes changed. */
function formatSpans({ service, files, spansByFile, bump }: Fixer): void {
  const format: ts.FormatCodeSettings = {
    ...ts.getDefaultFormatCodeSettings("\n"),
    indentSize: 2,
    tabSize: 2,
    convertTabsToSpaces: true,
    semicolons: ts.SemicolonPreference.Ignore,
  };
  for (const file of files) {
    for (const span of mergeSpans(spansByFile.get(file) ?? []).reverse()) {
      const edits = service.getFormattingEditsForRange(file, span.start, span.end, format);
      if (edits.length === 0) continue;
      fs.writeFileSync(file, applyTextChanges(fs.readFileSync(file, "utf8"), edits, []));
      bump(file);
    }
  }
}

// The annotate pass: TypeScript's own codefix writes each export's inferred type where isolatedDeclarations asks.
const SRC_CONFIG = "tsconfig.src.json";
const ANNOTATE_FIX = "fixMissingTypeAnnotationOnExports";
/** exactOptionalPropertyTypes: `| undefined` on an optional property that a caller passes a maybe-undefined value. */
const OPTIONAL_FIX = "addOptionalPropertyUndefined";
/** A fix can surface the next error in the same file, as an annotated function exposes its default parameters. */
const ANNOTATE_ROUNDS = 3;
/** isolatedDeclarations reports in the TS9xxx range, which nothing else uses. */
const ISOLATED_CODES = /^9\d{3}$/;

/** The files and options of `root`'s tsconfig.src.json; throws when it cannot be read. */
function srcProject(root: string): ts.ParsedCommandLine | undefined {
  const fail = (d: ts.Diagnostic) => {
    throw new Error(`ts-codemod: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  };
  return ts.getParsedCommandLineOfConfigFile(
    path.join(root, SRC_CONFIG),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: fail },
  );
}

/** The isolatedDeclarations errors left in the fixer's files, as `file(line,col): TScode message`. */
function leftErrors(root: string, { service, files }: Fixer): string[] {
  const program = service.getProgram();
  const found = files.flatMap((file) => program?.getDeclarationDiagnostics(program.getSourceFile(file)) ?? []);
  return found.filter((d) => ISOLATED_CODES.test(String(d.code))).map((d) => diagnosticLine(root, d));
}

function diagnosticLine(root: string, d: ts.Diagnostic): string {
  const where = d.file ? path.relative(root, d.file.fileName).split(path.sep).join("/") : "";
  const at = d.file?.getLineAndCharacterOfPosition(d.start ?? 0) ?? { line: 0, character: 0 };
  const text = ts.flattenDiagnosticMessageText(d.messageText, " ");
  return `${where}(${at.line + 1},${at.character + 1}): TS${d.code} ${text}`;
}

/**
 * Runs the annotate codefix over the files of `root`'s tsconfig.src.json until it changes nothing, formats what it
 * wrote, and returns the files it changed and the errors it could not fix.
 */
export function annotatePass(root: string): AnnotateResult {
  const project = srcProject(root);
  const fixer = fixerFor(root, project?.fileNames ?? [], project?.options ?? {});
  for (let round = 0; round < ANNOTATE_ROUNDS && applyFix(fixer, ANNOTATE_FIX); round++);
  // Each fix clears at least the error it was offered at, so the semantic errors bound the loop.
  const bound = fixer.files.reduce((sum, file) => sum + fixer.service.getSemanticDiagnostics(file).length, 0);
  for (let fixed = 0; fixed < bound && applyFirstFix(fixer, OPTIONAL_FIX); fixed++);
  formatSpans(fixer);
  const touched = fixer.files.filter((file) => (fixer.spansByFile.get(file) ?? []).length > 0);
  const changed = touched.map((file) => path.relative(root, file).split(path.sep).join("/")).sort();
  return { changed, left: leftErrors(root, fixer) };
}

const TYPED_TAG = /@(?:param|returns|return|type)(?=[ \t]+\{)/g;

function stripComment(comment: string): string {
  let out = comment;
  let from = 0;
  for (;;) {
    TYPED_TAG.lastIndex = from;
    const m = TYPED_TAG.exec(out);
    if (!m) return out;
    const tagEnd = m.index + m[0].length;
    const open = out.indexOf("{", tagEnd);
    let depth = 0;
    let close = -1;
    for (let i = open; i < out.length; i++) {
      if (out[i] === "{") depth++;
      else if (out[i] === "}" && --depth === 0) {
        close = i;
        break;
      }
    }
    if (close === -1) return out;
    const after = out.slice(close + 1).replace(/^[ \t]+/, "");
    const sep = after.startsWith("*/") ? " " : /^(\r?\n|$)/.test(after) ? "" : " ";
    out = out.slice(0, tagEnd) + sep + after;
    from = tagEnd;
  }
}

/** Drops `{type}` from `@param`, `@returns`, `@return` and `@type` tags; comments with a `@typedef` are kept. */
function stripJsDocTypes(text: string): string {
  return text.replace(/\/\*\*[\s\S]*?\*\//g, (c) => (c.includes("@typedef") ? c : stripComment(c)));
}

export function renamePass(root: string): RenameResult {
  const before = gitFiles(root);
  const set = renameSet(before);
  if (set.length === 0) return { changed: [], leftoverTypedefs: [] };

  const targets = set.map((f) => f.replace(SCRIPT_EXT, ".ts"));
  const taken = new Set(before);
  const seen = new Set<string>();
  for (const t of targets) {
    if (taken.has(t) || seen.has(t)) throw new Error(`ts-codemod: ${t} already exists or is the target of two files`);
    seen.add(t);
  }
  const changed = new Set<string>();
  set.forEach((from, i) => {
    const to = targets[i] as string; // same length as `set` by construction
    execFileSync("git", ["mv", "--", from, to], { cwd: root, stdio: "pipe" });
    changed.add(to);
  });

  const names = new Set(set.map((f) => path.posix.basename(f)));
  for (const rel of rewriteAll(root, gitFiles(root), (text) => rewriteSpellings(text, names))) changed.add(rel);

  convertJsDoc(
    root,
    targets.map((t) => path.join(root, t)),
  );

  const leftoverTypedefs: string[] = [];
  for (const rel of targets) {
    const abs = path.join(root, rel);
    const text = fs.readFileSync(abs, "utf8");
    const next = stripJsDocTypes(text);
    if (next !== text) fs.writeFileSync(abs, next);
    if (next.includes("@typedef")) leftoverTypedefs.push(rel);
  }
  return { changed: [...changed].sort(), leftoverTypedefs };
}

// The move pass: stock sources to `agents/`, scripts to `cli/scripts/`. A `from` ending in `/` is a dir.
// `spell: false` moves the files but leaves the spelling, which in this repo also names a generated path
// (`.agents/skills` holds codex's links, `.grok/hooks/*.json` and `.grok/roles` are written by sync).
interface Move {
  from: string;
  to: string;
  spell: boolean;
  /** Only files whose name under `from` matches. */
  only?: RegExp;
}

const MOVES: Move[] = [
  { from: ".rulesync/rules/", to: "agents/rules/", spell: true },
  { from: ".rulesync/subagents/", to: "agents/subagents/", spell: true },
  { from: ".rulesync/settings/", to: "agents/settings/", spell: true },
  { from: ".rulesync/global-settings/", to: "agents/global-settings/", spell: true },
  { from: ".rulesync/hooks.jsonc", to: "agents/hooks.jsonc", spell: true },
  { from: ".rulesync/mcp-policy.jsonc", to: "agents/mcp-policy.jsonc", spell: true },
  { from: ".rulesync/scripts/", to: "cli/scripts/", spell: true },
  { from: ".grok/hooks/orchestrate-parent.ts", to: "cli/scripts/orchestrate-parent.ts", spell: true },
  { from: ".grok/hooks/rtk-grok.ts", to: "cli/scripts/rtk-grok.ts", spell: true },
  { from: ".agents/skills/", to: "agents/skills/", spell: false },
  { from: ".grok/roles/", to: "agents/grok/roles/", spell: false },
  { from: ".grok/hooks/", to: "agents/grok/hooks/", spell: false, only: /^[^/]+\.json$/ },
];
const MOVE_DELETES = new Set([".grok/hooks/package.json"]);
/** Roots that hold a stock layout: the repo, and the frozen stock snapshot the goldens are built from. */
const STOCK_ROOTS = ["cli/sync/fixtures/consumer-stock/", ""];

/** Never rewritten: generated bytes, history, and this codemod's own table. */
const MOVE_SKIP = [/^\.tmp\//, /^cli\/sync\/fixtures\/golden\//, /^dev\/ts-codemod(\.test)?\.ts$/];
const MOVE_SKIP_FILES = new Set([...SKIP_TEXT, "cli/sync/stock-history.json"]);
/** Name the old layout on purpose (a consumer's copied `.rulesync/`, old defaults, history): only their imports follow. */
const KEEP_SPELLING = [
  /^cli\/sync\/migrate(\.test)?\.ts$/,
  /^cli\/sync\/fixtures\/copied/,
  /^cli\/sync\/stock-history\.ts$/,
  /^cli\/init(\.test)?\.ts$/,
  /^e2e\/init\.e2e\.ts$/,
  /^dev\/codemod-[^/]*\.ts$/,
];
/** A line the generated goldens carry verbatim. */
const KEEP_LINE = /Generated by emit-mcp-policy\.ts from \.rulesync\/mcp-policy\.jsonc/;

/** The move `rel` (a file, or a dir without its trailing `/`) falls under, and the stock root it sits in. */
function findMove(rel: string, moves: Move[]): { root: string; move: Move } | undefined {
  for (const root of STOCK_ROOTS) {
    if (!rel.startsWith(root)) continue;
    const rest = rel.slice(root.length);
    const move = moves.find((m) =>
      !m.from.endsWith("/")
        ? rest === m.from
        : rest.startsWith(m.from)
          ? !m.only || m.only.test(rest.slice(m.from.length))
          : rest === bare(m.from) && !m.only,
    );
    if (move) return { root, move };
  }
  return undefined;
}

function movedPath(rel: string, moves: Move[]): string {
  const hit = findMove(rel, moves);
  if (!hit) return rel;
  const rest = rel.slice(hit.root.length + bare(hit.move.from).length);
  return hit.root + bare(hit.move.to) + rest;
}

const bare = (p: string) => p.replace(/\/$/, "");
const SPELLED = MOVES.filter((m) => m.spell);
// A key's `.` and `/` may be regex-escaped (`\.rulesync\/scripts`, `\\.rulesync/scripts` in a template string).
const keyPattern = (key: string) =>
  [...key].map((c) => (c === "." ? "\\\\*\\." : c === "/" ? "\\\\*/" : escapeRegExp(c))).join("");
const SPELL_KEYS = SPELLED.map((m) => bare(m.from)).sort((a, b) => b.length - a.length);
// An old spelling that starts a path or follows a `/`: `.rulesync/scripts/x.ts`, `$d/.rulesync/hooks.jsonc`.
// A trailing `.` ends a sentence unless a name char follows it.
const KEY = `(?<![\\w.\\\\-])(?<key>${SPELL_KEYS.map(keyPattern).join("|")})(?![\\w-]|\\\\*\\.\\w)`;
// A relative token (`./x`, `../../y/z.ts`) goes first, so a key inside it is resolved, not respelled.
const MOVE_TOKEN = new RegExp(`(?<rel>(?<![\\w./@$~-])(?:\\.\\.?/)+[\\w./@+-]*)|${KEY}`, "g");
const KEY_TOKEN = new RegExp(KEY, "g");
// The same spellings as quoted `path.join` segments: `".rulesync", "scripts"`.
const SEGMENTS = SPELLED.map((m) => {
  const parts = bare(m.from).split("/").map(escapeRegExp);
  const re = new RegExp(`(["'])${parts.join("\\1(\\s*,\\s*)\\1")}\\1(?![\\w.-])`, "g");
  return { re, to: bare(m.to).split("/") };
});

/** The new spelling of a matched key, escaped the way the match was. */
function respellKey(match: string): string {
  const next = movedPath(match.replace(/\\+(?=[./])/g, ""), SPELLED);
  const dot = /(\\+)\./.exec(match)?.[1] ?? "";
  const slash = /(\\+)\//.exec(match)?.[1] ?? "";
  return next.replace(/[./]/g, (c) => (c === "." ? dot : slash) + c);
}

const respell = (text: string) => text.replace(KEY_TOKEN, respellKey);

interface MoveContext {
  /** Tracked files and their parent dirs, before the move. */
  known: Set<string>;
  oldRel: string;
  newRel: string;
  keepSpelling: boolean;
}

function moveRelative(token: string, after: string, ctx: MoveContext): string {
  const target = bare(path.posix.normalize(path.posix.join(path.posix.dirname(ctx.oldRel), token)));
  const glob = /^[*?{$]/.test(after);
  if (glob || target.startsWith("..") || !ctx.known.has(target)) return ctx.keepSpelling ? token : respell(token);
  // A target follows a spelled move, or the move-only entry the file itself moves with (a skill's sibling skill).
  // Anything else under a move-only entry is a link's text: `../../.agents/skills/x` names the codex link dir.
  let next = movedPath(target, SPELLED);
  const own = findMove(ctx.oldRel, MOVES);
  if (next === target && own && !own.move.spell && findMove(target, [own.move])?.root === own.root) {
    next = movedPath(target, [own.move]);
  }
  if (ctx.oldRel === ctx.newRel && next === target) return token;
  let rel = path.posix.relative(path.posix.dirname(ctx.newRel), next) || ".";
  if (rel !== "." && rel !== ".." && !rel.startsWith("../")) rel = `./${rel}`;
  if (token.endsWith("/") && !rel.endsWith("/")) rel += "/";
  return rel;
}

function moveLine(line: string, ctx: MoveContext): string {
  if (KEEP_LINE.test(line)) return line;
  let out = line.replace(MOVE_TOKEN, (m, rel: string | undefined, key: string | undefined, offset: number) => {
    if (rel !== undefined) return moveRelative(rel, line.slice(offset + m.length), ctx);
    return ctx.keepSpelling || key === undefined ? m : respellKey(m);
  });
  if (!ctx.keepSpelling) {
    for (const { re, to } of SEGMENTS) {
      out = out.replace(re, (_m, q: string, sep: string) => to.map((s) => q + s + q).join(sep));
    }
  }
  return out;
}

export function movePass(root: string): PassResult {
  const before = gitFiles(root);
  const known = new Set<string>();
  for (const f of before) for (let p = f; p !== "."; p = path.posix.dirname(p)) known.add(p);
  const deletes = before.filter((f) => STOCK_ROOTS.some((r) => f.startsWith(r) && MOVE_DELETES.has(f.slice(r.length))));
  const moves = new Map<string, string>();
  for (const f of before) {
    const to = movedPath(f, MOVES);
    if (to !== f && !deletes.includes(f)) moves.set(f, to);
  }
  const taken = new Set(before);
  for (const to of moves.values()) {
    if (taken.has(to)) throw new Error(`ts-codemod: ${to} already exists or is the target of two files`);
    taken.add(to);
  }

  const rewrites = new Map<string, string>();
  for (const oldRel of before) {
    if (deletes.includes(oldRel) || MOVE_SKIP_FILES.has(oldRel) || MOVE_SKIP.some((re) => re.test(oldRel))) continue;
    const text = readText(root, oldRel);
    if (text === null) continue;
    const newRel = moves.get(oldRel) ?? oldRel;
    const ctx = { known, oldRel, newRel, keepSpelling: KEEP_SPELLING.some((re) => re.test(oldRel)) };
    const next = text
      .split("\n")
      .map((line) => moveLine(line, ctx))
      .join("\n");
    if (next !== text) rewrites.set(newRel, next);
  }

  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  if (deletes.length > 0) git("rm", "-q", "--", ...deletes);
  for (const [from, to] of moves) {
    fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
    git("mv", "--", from, to);
  }
  for (const [rel, text] of rewrites) fs.writeFileSync(path.join(root, rel), text);
  return { changed: [...new Set([...deletes, ...moves.values(), ...rewrites.keys()])].sort() };
}

const PASSES = ["move", "runtime", "rename", "annotate"] as const;
type Pass = (typeof PASSES)[number];

const lines = (paths: readonly string[]) => paths.map((p) => `${p}\n`).join("");

function runAnnotate(root: string): void {
  const res = annotatePass(root);
  process.stdout.write(res.changed.length === 0 ? "nothing to annotate\n" : lines(res.changed));
  if (res.left.length > 0) process.stderr.write(`left for hand fixes:\n${lines(res.left)}`);
}

function runConvert(pass: Pass, root: string): void {
  const res = pass === "runtime" ? { ...runtimePass(root), leftoverTypedefs: [] } : renamePass(root);
  process.stdout.write(res.changed.length === 0 ? "nothing to convert\n" : lines(res.changed));
  if (res.leftoverTypedefs.length > 0) {
    process.stderr.write(`typedef blocks left for hand conversion:\n${lines(res.leftoverTypedefs)}`);
  }
}

function main(argv: string[]): number {
  const [arg = PASSES[0], rootArg] = argv;
  const pass = PASSES.find((name) => name === arg);
  if (pass === undefined) {
    process.stderr.write(`usage: bun dev/ts-codemod.ts [${PASSES.join("|")}] [root]\n`);
    return 2;
  }
  const root = rootArg ?? execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  if (pass === "move") process.stdout.write(lines(movePass(root).changed));
  else if (pass === "annotate") runAnnotate(root);
  else runConvert(pass, root);
  return 0;
}

// `import.meta.main` is bun-only; under vitest (node) it is undefined, so importing this module runs nothing.
if (import.meta.main) process.exitCode = main(process.argv.slice(2));
