// Shared setup for the `checkTsconfigs` suites: temp git repos, installs of this package, configs and messages.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { expect } from "vitest";

import { tempDir, useTempDirs } from "../sync/fixtures/temp-dirs.ts";

export const pkgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const SETS_FILES = (rel: string) =>
  `tsconfig: ${rel} sets "files", which replaces the base's reset.d.ts. List sources under "include".`;
export const NO_BASE = (rel: string) =>
  `tsconfig: ${rel} does not extend a base. Extend "@workerstack/repo/tsconfig/base", "bun", "worker" or "web".`;
export const NO_SRC = (dir: string) =>
  `tsconfig: ${dir} has no tsconfig.src.json; add one with "extends": ["./tsconfig.json", "@workerstack/repo/tsconfig/strict"] and an "exclude" that repeats tsconfig.json's and adds the tests`;
export const WEAK = (rel: string, flags: string) =>
  `tsconfig: ${rel} resolves without ${flags}; extend "@workerstack/repo/tsconfig/strict" and drop the override`;
export const INCLUDES = (rel: string, file: string) =>
  `tsconfig: ${rel} includes ${file}; add "**/*.reject.ts" and "**/*.reject.tsx" to its exclude`;
export const UNRUN = (rel: string) =>
  `tsconfig: ${rel} is run by no gate; delete it, or run it from a package.json script with tsc -p ${rel}`;
export const STRICT_FLAGS = [
  "isolatedDeclarations",
  "erasableSyntaxOnly",
  "verbatimModuleSyntax",
  "exactOptionalPropertyTypes",
  "noUncheckedIndexedAccess",
] as const;

export function gitRepo(): string {
  const dir = tempDir("check-tsconfig-");
  execFileSync("git", ["init", "-q"], { cwd: dir });
  fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");
  return dir;
}

/** A git repo whose `node_modules/@workerstack/repo` links to this checkout, as an isolated install places it. */
export function consumerRepo(): string {
  const dir = gitRepo();
  const scope = path.join(dir, "node_modules", "@workerstack");
  fs.mkdirSync(scope, { recursive: true });
  fs.symlinkSync(pkgRoot, path.join(scope, "repo"), "junction");
  return dir;
}

/**
 * A git repo with `@workerstack/repo` copied into `node_modules` as a real folder, as a hoisted install places it,
 * so a `/// <reference types>` in its bases resolves from the consumer's `node_modules`. Returns the copy too.
 */
export function hoistedRepo(): { dir: string; installed: string } {
  const dir = gitRepo();
  const modules = path.join(dir, "node_modules");
  const installed = path.join(modules, "@workerstack", "repo");
  fs.mkdirSync(installed, { recursive: true });
  fs.copyFileSync(path.join(pkgRoot, "package.json"), path.join(installed, "package.json"));
  fs.cpSync(path.join(pkgRoot, "tsconfig"), path.join(installed, "tsconfig"), {
    recursive: true,
  });
  const reset = path.dirname(createRequire(import.meta.url).resolve("@total-typescript/ts-reset/package.json"));
  fs.mkdirSync(path.join(modules, "@total-typescript"), { recursive: true });
  fs.symlinkSync(reset, path.join(modules, "@total-typescript", "ts-reset"), "junction");
  return { dir, installed };
}

export function write(dir: string, rel: string, content: string | object): string {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
  return file;
}

/** The `tsconfig.src.json` beside `<owner>/tsconfig.json` that Usage asks for, `compilerOptions` over the strict base. */
export function srcConfig(dir: string, owner: string, compilerOptions: object = {}): string {
  return write(dir, path.posix.join(owner, "tsconfig.src.json"), {
    compilerOptions,
    exclude: ["node_modules", "**/*.test.ts"],
    extends: ["./tsconfig.json", "@workerstack/repo/tsconfig/strict"],
  });
}

export type Diagnostic = { code: number; file: string | undefined; text: string };

/** Every diagnostic `tsc -p <configFile>` would print, with `file` posix and relative to the config's folder. */
export function diagnostics(configFile: string): Diagnostic[] {
  const dir = path.dirname(configFile);
  const read = ts.readConfigFile(configFile, ts.sys.readFile);
  expect(read.error).toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dir, undefined, configFile);
  const program = ts.createProgram({
    options: parsed.options,
    rootNames: parsed.fileNames,
  });
  return [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map((d) => ({
    code: d.code,
    file: d.file && path.relative(dir, d.file.fileName).split(path.sep).join("/"),
    text: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
  }));
}

export const UNKNOWN_TO_NUMBER: Diagnostic = {
  code: 2322,
  file: "src/a.ts",
  text: "Type 'unknown' is not assignable to type 'number'.",
};

/** A config extending the bun base, which has nothing to report but whether a gate runs it. */
export function plainConfig(dir: string, rel: string, extra: object = {}): void {
  write(dir, rel, {
    extends: "@workerstack/repo/tsconfig/bun",
    include: ["src"],
    ...extra,
  });
}

export function script(dir: string, rel: string, command: string): void {
  write(dir, rel, { name: "pkg", scripts: { typecheck: command } });
}

// Each program parses the runtime's lib and types, over a second on a fast machine, so it gets more than the
// preset's 5s. src/a.ts is a script (no import or export): noUnusedLocals leaves its top-level names alone.
export const PROGRAM_TIMEOUT = 30_000;

/** Removes every repo `gitRepo` made after each test of the calling file. */
export function useTsconfigKit(): void {
  useTempDirs();
}
