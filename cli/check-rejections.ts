/**
 * Type-level tests: code that must not compile, without `@ts-` directives. A `*.reject.ts(x)` file sits outside its
 * package's type check (tsconfig `exclude`) and marks each statement that must fail with a `rejects: <text>` comment
 * above it. The check type-checks it on TypeScript 7 with its owner's `tsconfig.src.json` options: every marked
 * statement fails with an error containing its text, and nothing else fails. A mark covers its statement's lines up to
 * the next blank line, so the formatter can wrap it.
 */
import fs from "node:fs";
import path from "node:path";

import type { Diagnostic, Project } from "typescript/unstable/async";

import { byCodeUnit } from "./sync/by-code-unit.ts";
import { configOf, lineOf, messageOf, type TsRun, withFiles, withTsApi } from "./ts-api.ts";
import { ownerOf, posix } from "./ts-program.ts";
import { RUNTIME_CONFIG, SRC_CONFIG } from "./tsconfig.constants.ts";

/** A statement that must not compile (its first and last one-based lines), and the text its error must contain. */
export type Rejection = { line: number; end: number; text: string };

/** A type error on a one-based line, as `TS<code>: <text>`. */
type TypeError = { line: number; message: string };

/** A problem's line, for sorting, and its text without the file. */
type Problem = { line: number; text: string };

// Both comment forms are read: the line form is what the harness was written for, and a repo that bans line comments
// leaves only the block form. `repo/no-block-comment` writes an own-line comment as `//`; an inline `/* */` stays.
const MARK = /^\s*(?:\/\/|\/\*)\s*rejects:\s*(.*?)\s*(?:\*\/)?$/;
const REJECT_FILE = /\.reject\.tsx?$/;
const DECLARATION = /\.d\.[cm]?ts$/;
const LINE_COMMENT = "//";
const BLOCK_OPEN = "/*";
const BLOCK_CLOSE = "*/";

/** The start of a module's printed type, which carries the path of the checkout it was checked in. */
const ABSOLUTE_IMPORT = 'import("/';

/** Where the reader of `rejections` is: the marks waiting for a statement, the statements still growing. */
type Scan = { found: Rejection[]; pending: string[]; open: Rejection[]; inBlock: boolean };

function isCode(text: string): boolean {
  return text !== "" && !text.startsWith(LINE_COMMENT) && !text.startsWith(BLOCK_OPEN);
}

/** A code line: it extends the open statements, and starts one for the marks waiting. */
function scanCode(scan: Scan, number: number): void {
  for (const rejection of scan.open) rejection.end = number;

  if (scan.pending.length === 0) return;
  scan.open = scan.pending.map((pending) => ({ end: number, line: number, text: pending }));
  scan.found.push(...scan.open);
  scan.pending = [];
}

function scanLine(scan: Scan, line: string, number: number): void {
  const text = line.trim();

  if (scan.inBlock) {
    scan.inBlock = !text.includes(BLOCK_CLOSE);

    return;
  }

  const mark = MARK.exec(line)?.[1] ?? "";

  if (mark !== "" || text === "") scan.open = [];

  if (text.startsWith(BLOCK_OPEN) && !text.includes(BLOCK_CLOSE)) scan.inBlock = true;

  if (mark !== "") scan.pending.push(mark.trim());
  else if (isCode(text)) scanCode(scan, number);
}

/**
 * The marked statements: each `rejects:` comment applies to the next line that is not a comment or blank, through the
 * line before the next blank line or mark. Prose in a block comment over several lines is not code a mark applies to.
 */
export function rejections(source: string): Rejection[] {
  const scan: Scan = { found: [], inBlock: false, open: [], pending: [] };

  for (const [index, line] of source.split("\n").entries()) scanLine(scan, line, index + 1);

  return scan.found;
}

/** What is wrong with one mark, given the errors of the file. */
function markProblem(rejection: Rejection, errors: readonly TypeError[]): Problem | undefined {
  const { line, text } = rejection;

  // The compiler prints a module's type with the path of the checkout it ran in, so a mark quoting one passes in that
  // checkout alone: a worktree or CI prints another.
  if (text.includes(ABSOLUTE_IMPORT)) {
    return {
      line,
      text: `line ${line}'s mark quotes an absolute import path, which differs per checkout: mark the text before it`,
    };
  }

  const onLine = errors.filter((error) => error.line >= line && error.line <= rejection.end);

  if (onLine.length === 0) return { line, text: `line ${line} compiles; it must reject: ${text}` };

  if (onLine.some((error) => error.message.includes(text))) return undefined;

  return { line, text: `line ${line} fails without "${text}": ${onLine.map((error) => error.message).join("; ")}` };
}

/** A file's problems in line order: marks its errors do not match, and errors no mark covers. */
function fileProblems(source: string, errors: readonly TypeError[]): string[] {
  const marked = rejections(source);
  const problems = marked.map((rejection) => markProblem(rejection, errors)).filter((p) => p !== undefined);

  for (const error of errors) {
    const covered = marked.some((rejection) => error.line >= rejection.line && error.line <= rejection.end);

    if (!covered) problems.push({ line: error.line, text: `line ${error.line} fails unmarked: ${error.message}` });
  }

  return problems.toSorted((a, b) => a.line - b.line).map((problem) => problem.text);
}

/** The diagnostics of a list that belong to `file` itself, each with its line in `text`. */
function errorsIn(file: string, text: string, diagnostics: readonly Diagnostic[]): TypeError[] {
  return diagnostics
    .filter((diagnostic) => diagnostic.fileName === file)
    .map((diagnostic) => ({ line: lineOf(text, diagnostic.pos), message: messageOf(diagnostic) }));
}

/** Who checks a group of reject files: the project over them, the root they are named from, the owner's options. */
type Checker = { project: Project; root: string; declaration: boolean };

/** The errors tsc would print for `file`: declaration errors too when the owner emits declarations. */
async function typeErrors({ declaration, project }: Checker, file: string, text: string): Promise<TypeError[]> {
  const semantic = await project.program.getSemanticDiagnostics(file);
  const declarations = declaration ? await project.program.getDeclarationDiagnostics(file) : [];

  return errorsIn(file, text, [...semantic, ...declarations]);
}

/**
 * One reject file's problems, each prefixed with its root-relative path; none for a file deleted since it was
 * listed.
 */
async function fileProblemsOf(checker: Checker, file: string): Promise<string[]> {
  const { project, root } = checker;
  const source = await project.program.getSourceFile(file);

  if (source === undefined) return [];
  const rel = path.posix.relative(root, file);
  // A syntax error leaves no statement checked: report it, never "compiles".
  const syntax = errorsIn(file, source.text, await project.program.getSyntacticDiagnostics(file));

  if (syntax.length > 0) {
    return syntax.map(
      (error) => `${rel}: line ${error.line} does not parse, so nothing in the file was type-checked: ${error.message}`,
    );
  }

  const errors = await typeErrors(checker, file, source.text);

  return fileProblems(source.text, errors).map((problem) => `${rel}: ${problem}`);
}

/**
 * The owner's strict config when it has one; else its `tsconfig.json`, whose missing sibling `checkTsconfigs`
 * names.
 */
function baseOf(root: string, dir: string): string {
  return fs.existsSync(path.join(root, dir, SRC_CONFIG)) ? SRC_CONFIG : RUNTIME_CONFIG;
}

/** The owner's config and the declarations it lists, or why it cannot be read; the defaults and none for no owner. */
async function setupOf(run: TsRun, root: string, dir: string | null) {
  if (dir === null) return { ok: true, value: { ambient: [], base: null, declaration: false } } as const;
  const base = baseOf(root, dir);
  const read = await configOf(run, path.posix.join(root, dir, base));

  if (!read.ok) return { error: `${path.posix.join(dir, base)}: ${read.error}`, ok: false } as const;
  const ambient = read.value.fileNames.filter((fileName) => DECLARATION.test(fileName));

  return { ok: true, value: { ambient, base, declaration: read.value.options.declaration === true } } as const;
}

/** One owner's reject files: the root, the owner's root-relative dir or null for none, the files' posix paths. */
type Group = { root: string; dir: string | null; targets: readonly string[] };

/** The problems of one owner's reject files, from one project over them and the declarations its config lists. */
async function groupProblems(run: TsRun, { dir, root, targets }: Group): Promise<string[]> {
  const setup = await setupOf(run, root, dir);

  if (!setup.ok) return [setup.error];
  const { ambient, base, declaration } = setup.value;
  const spec = { base, dir: dir === null ? root : path.posix.join(root, dir), files: [...ambient, ...targets] };

  return withFiles(run, spec, async (project) => {
    const problems: string[] = [];

    for (const file of targets) problems.push(...(await fileProblemsOf({ declaration, project, root }, file)));

    return problems;
  });
}

/**
 * What is wrong with the reject files among `files` (root-relative POSIX paths), one line each, by file then line: a
 * marked statement that compiles or fails without its text, a mark quoting a checkout's path, an error no mark
 * covers, and a file that does not parse. Empty when every file rejects exactly what it marks.
 */
export function rejectionProblems(root: string, files: readonly string[]): Promise<string[]> {
  const real = posix(fs.realpathSync(root));
  const groups = new Map<string | null, string[]>();

  for (const rel of files.filter((file) => REJECT_FILE.test(file)).toSorted(byCodeUnit)) {
    const dir = ownerOf(real, rel);
    groups.set(dir, [...(groups.get(dir) ?? []), path.posix.join(real, rel)]);
  }

  return withTsApi(real, async (run) => {
    const problems: string[] = [];

    for (const [dir, targets] of groups) problems.push(...(await groupProblems(run, { dir, root: real, targets })));

    return problems;
  });
}
