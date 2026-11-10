/**
 * Type-level tests: code that must not compile, without `@ts-` directives. A `*.reject.ts(x)` file sits outside its
 * package's type check (tsconfig `exclude`) and marks each statement that must fail with a `rejects: <text>` comment
 * above it. The check type-checks it in-process with its owner's `tsconfig.src.json` options: every marked statement
 * fails with an error containing its text, and nothing else fails. A mark covers its statement's lines up to the next
 * blank line, so the formatter can wrap it.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { RUNTIME_CONFIG, SRC_CONFIG } from "./tsconfig.constants.ts";
import { ownerOf, posix, setupOf } from "./ts-program.ts";

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

const isCode = (text: string): boolean => text !== "" && !text.startsWith(LINE_COMMENT) && !text.startsWith(BLOCK_OPEN);

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
  const mark = MARK.exec(line)?.[1];
  if (mark || text === "") scan.open = [];
  if (text.startsWith(BLOCK_OPEN) && !text.includes(BLOCK_CLOSE)) scan.inBlock = true;
  if (mark) scan.pending.push(mark.trim());
  else if (isCode(text)) scanCode(scan, number);
}

/**
 * The marked statements: each `rejects:` comment applies to the next line that is not a comment or blank, through the
 * line before the next blank line or mark. Prose in a block comment over several lines is not code a mark applies to.
 */
export function rejections(source: string): Rejection[] {
  const scan: Scan = { found: [], pending: [], open: [], inBlock: false };
  for (const [index, line] of source.split("\n").entries()) scanLine(scan, line, index + 1);
  return scan.found;
}

const lineOf = (diagnostic: ts.DiagnosticWithLocation): number =>
  diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1;

const messageOf = (diagnostic: ts.Diagnostic): string =>
  `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;

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
  return problems.sort((a, b) => a.line - b.line).map((problem) => problem.text);
}

/** The errors tsc would print for `file` under the program's options. */
function typeErrors(program: ts.Program, file: ts.SourceFile): TypeError[] {
  const declarations = program.getCompilerOptions().declaration === true ? program.getDeclarationDiagnostics(file) : [];
  return [...program.getSemanticDiagnostics(file), ...declarations]
    .filter((diagnostic): diagnostic is ts.DiagnosticWithLocation => diagnostic.start !== undefined)
    .map((diagnostic) => ({ line: lineOf(diagnostic), message: messageOf(diagnostic) }));
}

/** One reject file's problems, each prefixed with its root-relative path. */
function fileProblemsOf(program: ts.Program, root: string, file: ts.SourceFile): string[] {
  const rel = path.posix.relative(root, file.fileName);
  // A syntax error leaves no statement checked: report it, never "compiles".
  const syntax = program.getSyntacticDiagnostics(file);
  if (syntax.length > 0) {
    return syntax.map(
      (d) => `${rel}: line ${lineOf(d)} does not parse, so nothing in the file was type-checked: ${messageOf(d)}`,
    );
  }
  return fileProblems(file.text, typeErrors(program, file)).map((problem) => `${rel}: ${problem}`);
}

/** The owner's strict config when it has one; else its `tsconfig.json`, whose missing sibling `checkTsconfigs` names. */
function configOf(root: string, dir: string): string {
  return fs.existsSync(path.join(root, dir, SRC_CONFIG)) ? SRC_CONFIG : RUNTIME_CONFIG;
}

/** The problems of one owner's reject files, from one program over them and the declarations its config lists. */
function groupProblems(root: string, dir: string | null, targets: readonly string[]): string[] {
  const setup = setupOf(root, dir, dir === null ? SRC_CONFIG : configOf(root, dir));
  if (!setup.ok) return setup.errors;
  const ambient = setup.value.fileNames.filter((fileName) => DECLARATION.test(fileName));
  const program = ts.createProgram({ rootNames: [...ambient, ...targets], options: setup.value.options });
  // A reject file deleted since it was listed is not in the program, and has nothing left to check.
  const read = program.getSourceFiles().filter((file) => targets.includes(file.fileName));
  return read.flatMap((file) => fileProblemsOf(program, root, file));
}

/**
 * What is wrong with the reject files among `files` (root-relative POSIX paths), one line each, by file then line: a
 * marked statement that compiles or fails without its text, a mark quoting a checkout's path, an error no mark
 * covers, and a file that does not parse. Empty when every file rejects exactly what it marks.
 */
export function rejectionProblems(root: string, files: readonly string[]): string[] {
  const real = posix(fs.realpathSync(root));
  const groups = new Map<string | null, string[]>();
  for (const rel of files.filter((file) => REJECT_FILE.test(file)).sort()) {
    const dir = ownerOf(real, rel);
    groups.set(dir, [...(groups.get(dir) ?? []), path.posix.join(real, rel)]);
  }
  return [...groups].flatMap(([dir, targets]) => groupProblems(real, dir, targets));
}
