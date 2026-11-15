/** The one way this package opens TypeScript 7's API and reads a tsconfig through it. */
import fs from "node:fs";

import { parse, type ParseError } from "jsonc-parser";
import { API, type CompilerOptions, type Diagnostic, type Project } from "typescript/unstable/async";

import type { Result } from "./result.ts";
import { errorMessage } from "./sync-errors.ts";

/** A tsconfig resolved through its extends chain: the options it sets and the root files it type-checks. */
export type TsConfig = { options: Readonly<CompilerOptions>; fileNames: readonly string[] };

/** The diagnostic codes of JSON syntax errors; an option, extends or no-inputs error leaves the config readable. */
const SYNTAX_ERRORS = { from: 1000, to: 2000 };

/** Everything after the first line of a message: a tsgo panic carries its Go stack below it. */
const FIRST_LINE_REST = /\n[\s\S]*/;

/**
 * One open API and the configs it reads from memory, by posix path, before the disk. `opened` counts the configs
 * withFiles has made, so no two on one API share a name.
 */
export type TsRun = { readonly api: API; readonly virtual: Map<string, string>; opened: number };

/** Which files withFiles checks, in which dir, under the config there it extends; null checks them under defaults. */
export type FilesSpec = Readonly<{ dir: string; base: string | null; files: readonly string[] }>;

/** The options a file with no tsconfig.json above it is checked with: strict, resolved as a bundler would. */
const NO_OWNER_OPTIONS = {
  allowImportingTsExtensions: true,
  module: "preserve",
  moduleResolution: "bundler",
  noEmit: true,
  skipLibCheck: true,
  strict: true,
  target: "esnext",
} as const;

/** The indent each level of a chained message adds, as tsc prints it on one line. */
const CHAIN_INDENT = "  ";

/**
 * Runs `work` on one API rooted at `cwd`, then closes it, which ends its tsgo process whether `work` threw or not.
 * The API reads a file in `virtual` from there, and every other file from disk.
 */
export async function withTsApi<T>(cwd: string, work: (run: TsRun) => Promise<T>): Promise<T> {
  const virtual = new Map<string, string>();
  const api = new API({ cwd, fs: { readFile: (file) => virtual.get(file) } });

  try {
    return await work({ api, opened: 0, virtual });
  } finally {
    await api.close();
  }
}

/** The text of the config withFiles opens: `base`'s options, or the defaults, over exactly the listed files. */
function filesConfig(spec: FilesSpec): string {
  const options = spec.base === null ? { compilerOptions: NO_OWNER_OPTIONS } : { compilerOptions: { noEmit: true } };
  const base = spec.base === null ? {} : { extends: `./${spec.base}` };

  return JSON.stringify({ ...base, ...options, files: spec.files, include: [] });
}

/**
 * Runs `work` on a project of `spec`'s files from a config in memory, then closes the project and forgets the config,
 * whether `work` threw or not. A listed file that is gone is not in the project.
 */
export async function withFiles<T>(run: TsRun, spec: FilesSpec, work: (project: Project) => Promise<T>): Promise<T> {
  run.opened += 1;
  const config = `${spec.dir}/tsconfig.repo-${run.opened}.json`;
  run.virtual.set(config, filesConfig(spec));

  try {
    const snapshot = await run.api.updateSnapshot({ openProjects: [config] });

    try {
      const project = snapshot.getProject(config);

      if (project === undefined) throw new Error(`TypeScript opened no project for ${config}`);

      return await work(project);
    } finally {
      await snapshot.dispose();
      const closed = await run.api.updateSnapshot({ closeProjects: [config] });
      await closed.dispose();
    }
  } finally {
    run.virtual.delete(config);
  }
}

/** A chained message's text: each level on the same line, two more spaces in for each level down. */
function chainText(diagnostic: Diagnostic, depth: number): string {
  const lead = depth === 0 ? "" : ` ${CHAIN_INDENT.repeat(depth)}`;
  const next = (diagnostic.messageChain ?? []).map((link) => chainText(link, depth + 1));

  return [`${lead}${diagnostic.text}`, ...next].join("");
}

/** A diagnostic as `TS<code>: <text>`, its chain flattened onto one line as tsc prints it. */
export function messageOf(diagnostic: Diagnostic): string {
  return `TS${diagnostic.code}: ${chainText(diagnostic, 0)}`;
}

/** The one-based line of offset `pos` in `text`. */
export function lineOf(text: string, pos: number): number {
  return text.slice(0, pos).split("\n").length;
}

/** The first line of what the API threw: a file it cannot read, or a tsgo panic on a config it cannot parse. */
async function parsed({ api }: TsRun, file: string): Promise<Result<TsConfig, string>> {
  try {
    return { ok: true, value: await api.parseConfigFile(file) };
  } catch (error) {
    return { error: errorMessage(error).replace(FIRST_LINE_REST, ""), ok: false };
  }
}

/**
 * The text of the first JSON syntax error in `file` itself; a config it extends reports its own. A config removed
 * after its parse opens no project and has none.
 */
async function syntaxError({ api }: TsRun, file: string): Promise<string | undefined> {
  const snapshot = await api.updateSnapshot({ openProjects: [file] });

  try {
    const project = snapshot.getProject(file);

    if (project === undefined) return undefined;
    const diagnostics = await project.program.getConfigFileParsingDiagnostics();

    const syntax = diagnostics.find(
      ({ code, fileName }) =>
        code >= SYNTAX_ERRORS.from && code < SYNTAX_ERRORS.to && fileName === project.configFileName,
    );

    return syntax?.text;
  } finally {
    await snapshot.dispose();
    const closed = await api.updateSnapshot({ closeProjects: [file] });
    await closed.dispose();
  }
}

/** Whether `file`'s text has a JSON syntax error, as the jsonc reader sees it, comments and trailing commas allowed. */
function looksBroken(file: string): boolean {
  const errors: ParseError[] = [];
  parse(fs.readFileSync(file, "utf8"), errors, { allowTrailingComma: true });

  return errors.length > 0;
}

/**
 * The tsconfig at the posix path `file`, or why it cannot be read: the text of its first JSON syntax error, or what
 * the API threw. The parse runs first because a tsgo panic there leaves the API usable, while one in an opened
 * project wedges every later request. Only the API's parse drops syntax errors, and opening a project to see them
 * parses every source file, so a project opens only for text the jsonc reader finds broken; it is closed again, so a
 * later read sees only its own errors. Reads on one API go one at a time: two at once leave a handle that keeps the
 * process alive after close.
 */
export async function configOf(run: TsRun, file: string): Promise<Result<TsConfig, string>> {
  const read = await parsed(run, file);

  if (!read.ok || !looksBroken(file)) return read;
  const syntax = await syntaxError(run, file);

  return syntax === undefined ? read : { error: syntax, ok: false };
}
