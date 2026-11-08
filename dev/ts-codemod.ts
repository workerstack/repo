#!/usr/bin/env bun
// Converts the repo's `.mjs`/`.js` scripts to typed `.ts` run by bun, in two rerunnable passes:
//   runtime  `node <script>` becomes `bun <script>` and the shebangs follow
//   rename   git mv to `.ts`, rewrite every spelling of the names, turn JSDoc into types
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

/** Applies the JSDoc codefixes to `files` (absolute paths), then formats only the spans they changed. */
function convertJsDoc(root: string, files: string[]): void {
  if (files.length === 0) return;
  const versions = new Map(files.map((f) => [f, 0]));
  const options = compilerOptions(root);
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
  const service = ts.createLanguageService(host);
  const spansByFile = new Map<string, Span[]>(files.map((f) => [f, []]));
  const bump = (f: string) => versions.set(f, (versions.get(f) ?? 0) + 1);

  for (const fixId of ["convertTypedefToType", "annotateWithTypeFromJSDoc"]) {
    for (const file of files) {
      const fix = service.getCombinedCodeFix({ type: "file", fileName: file }, fixId, {}, {});
      for (const change of fix.changes) {
        const spans = spansByFile.get(change.fileName);
        if (!spans || change.textChanges.length === 0) continue;
        const text = fs.readFileSync(change.fileName, "utf8");
        fs.writeFileSync(change.fileName, applyTextChanges(text, change.textChanges, spans));
        bump(change.fileName);
      }
    }
  }

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

function main(argv: string[]): number {
  const [pass, rootArg] = argv;
  if (pass !== "runtime" && pass !== "rename") {
    process.stderr.write("usage: bun dev/ts-codemod.ts runtime|rename [root]\n");
    return 2;
  }
  const root =
    rootArg ?? execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const res = pass === "runtime" ? { ...runtimePass(root), leftoverTypedefs: [] } : renamePass(root);
  process.stdout.write(res.changed.length === 0 ? "nothing to convert\n" : res.changed.join("\n") + "\n");
  if (res.leftoverTypedefs.length > 0) {
    process.stderr.write(`typedef blocks left for hand conversion:\n${res.leftoverTypedefs.join("\n")}\n`);
  }
  return 0;
}

// `import.meta.main` is bun-only; under vitest (node) it is undefined, so importing this module runs nothing.
if (import.meta.main) process.exitCode = main(process.argv.slice(2));
