import path from "node:path";

import ts from "typescript";

import { BUILD_CONFIG, DECLARATION } from "./type-surface.constants.ts";

/** The diagnostic codes of JSON syntax errors; an option, extends or no-inputs error leaves the config readable. */
const SYNTAX_ERRORS = { from: 1000, to: 2000 };

function isSyntaxError({ code }: ts.Diagnostic): boolean {
  return code >= SYNTAX_ERRORS.from && code < SYNTAX_ERRORS.to;
}

/**
 * What a package's tsconfig.build.json emits: each output file, script and declaration, with the source it is built
 * from, as typescript names them for the config's own rootDir, outDir and declarationDir; undefined when the package
 * has no build config, or one that cannot be read or is not valid JSON.
 */
export function buildOutputs(dir: string): Map<string, string> | undefined {
  const host = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} };
  const parsed = ts.getParsedCommandLineOfConfigFile(path.join(dir, BUILD_CONFIG), {}, host);

  if (parsed === undefined || parsed.errors.some(isSyntaxError)) return undefined;
  const options = { ...parsed.options, declaration: true, emitDeclarationOnly: false, noEmit: false };
  const commandLine = { ...parsed, options };
  const outputs = new Map<string, string>();

  for (const source of parsed.fileNames.filter((file) => !DECLARATION.test(file))) {
    for (const output of ts.getOutputFileNames(commandLine, source, !ts.sys.useCaseSensitiveFileNames))
      outputs.set(output, source);
  }

  return outputs;
}
