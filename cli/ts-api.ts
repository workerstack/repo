/** The one way this package opens TypeScript 7's API and reads a tsconfig through it. */
import fs from "node:fs";

import { parse, type ParseError } from "jsonc-parser";
import { API, type CompilerOptions } from "typescript/unstable/async";

import type { Result } from "./result.ts";
import { errorMessage } from "./sync-errors.ts";

/** A tsconfig resolved through its extends chain: the options it sets and the root files it type-checks. */
export type TsConfig = { options: Readonly<CompilerOptions>; fileNames: readonly string[] };

/** The diagnostic codes of JSON syntax errors; an option, extends or no-inputs error leaves the config readable. */
const SYNTAX_ERRORS = { from: 1000, to: 2000 };

/** Everything after the first line of a message: a tsgo panic carries its Go stack below it. */
const FIRST_LINE_REST = /\n[\s\S]*/;

/** Runs `work` on one API rooted at `cwd`, then closes it, which ends its tsgo process whether `work` threw or not. */
export async function withTsApi<T>(cwd: string, work: (api: API) => Promise<T>): Promise<T> {
  const api = new API({ cwd });

  try {
    return await work(api);
  } finally {
    await api.close();
  }
}

/** The first line of what the API threw: a file it cannot read, or a tsgo panic on a config it cannot parse. */
async function parsed(api: API, file: string): Promise<Result<TsConfig, string>> {
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
async function syntaxError(api: API, file: string): Promise<string | undefined> {
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
export async function configOf(api: API, file: string): Promise<Result<TsConfig, string>> {
  const read = await parsed(api, file);

  if (!read.ok || !looksBroken(file)) return read;
  const syntax = await syntaxError(api, file);

  return syntax === undefined ? read : { error: syntax, ok: false };
}
