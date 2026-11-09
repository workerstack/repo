import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { checkTsconfigs } from "./check-tsconfig.ts";

const pkgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const SETS_FILES = (rel: string) =>
  `tsconfig: ${rel} sets "files", which replaces the base's reset.d.ts. List sources under "include".`;
const NO_BASE = (rel: string) =>
  `tsconfig: ${rel} does not extend a base. Extend "@workerstack/repo/tsconfig/base", "bun", "worker" or "web".`;

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function gitRepo(): string {
  const dir = tmp("check-tsconfig-");
  execFileSync("git", ["init", "-q"], { cwd: dir });
  fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");
  return dir;
}

/** A git repo whose `node_modules/@workerstack/repo` links to this checkout, as an isolated install places it. */
function consumerRepo(): string {
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
function hoistedRepo(): { dir: string; installed: string } {
  const dir = gitRepo();
  const modules = path.join(dir, "node_modules");
  const installed = path.join(modules, "@workerstack", "repo");
  fs.mkdirSync(installed, { recursive: true });
  fs.copyFileSync(path.join(pkgRoot, "package.json"), path.join(installed, "package.json"));
  fs.cpSync(path.join(pkgRoot, "tsconfig"), path.join(installed, "tsconfig"), { recursive: true });
  const reset = path.dirname(createRequire(import.meta.url).resolve("@total-typescript/ts-reset/package.json"));
  fs.mkdirSync(path.join(modules, "@total-typescript"), { recursive: true });
  fs.symlinkSync(reset, path.join(modules, "@total-typescript", "ts-reset"), "junction");
  return { dir, installed };
}

function write(dir: string, rel: string, content: string | object): string {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
  return file;
}

type Diagnostic = { code: number; file: string | undefined; text: string };

/** Every diagnostic `tsc -p <configFile>` would print, with `file` posix and relative to the config's folder. */
function diagnostics(configFile: string): Diagnostic[] {
  const dir = path.dirname(configFile);
  const read = ts.readConfigFile(configFile, ts.sys.readFile);
  expect(read.error).toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dir, undefined, configFile);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  return [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map((d) => ({
    code: d.code,
    file: d.file && path.relative(dir, d.file.fileName).split(path.sep).join("/"),
    text: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
  }));
}

const UNKNOWN_TO_NUMBER: Diagnostic = {
  code: 2322,
  file: "src/a.ts",
  text: "Type 'unknown' is not assignable to type 'number'.",
};

describe("checkTsconfigs", () => {
  it.each(["base", "bun", "worker", "web"])("passes a package that extends the %s base", (base) => {
    const dir = consumerRepo();
    write(dir, "packages/api/tsconfig.json", { extends: `@workerstack/repo/tsconfig/${base}`, include: ["src"] });
    write(dir, "packages/api/src/a.ts", 'const n: number = JSON.parse("1")\n');
    expect(checkTsconfigs(dir, pkgRoot)).toEqual([]);
  });

  // Each program parses the runtime's lib and types, over a second on a fast machine, so it gets more than the
  // preset's 5s. src/a.ts is a script (no import or export): noUnusedLocals leaves its top-level names alone.
  const PROGRAM_TIMEOUT = 30_000;

  it.each([
    ["bun", "const v: string = Bun.version\n"],
    ["web", "const t: string = document.title\n"],
  ])(
    "the %s base types its runtime and keeps ts-reset",
    (base, runtimeLine) => {
      const dir = consumerRepo();
      const config = write(dir, "packages/api/tsconfig.json", {
        extends: `@workerstack/repo/tsconfig/${base}`,
        include: ["src"],
      });
      write(dir, "packages/api/src/a.ts", `const n: number = JSON.parse("1")\n${runtimeLine}`);
      const found = diagnostics(config);
      expect(found.filter((d) => d.code === 2688)).toEqual([]);
      expect(found).toEqual([UNKNOWN_TO_NUMBER]);
    },
    PROGRAM_TIMEOUT,
  );

  it(
    "the worker base types the workers runtime and keeps ts-reset",
    () => {
      const { dir, installed } = hoistedRepo();
      write(dir, "node_modules/@cloudflare/workers-types/package.json", {
        name: "@cloudflare/workers-types",
        types: "index.d.ts",
      });
      write(dir, "node_modules/@cloudflare/workers-types/index.d.ts", "declare const WORKERS_STUB: string\n");
      const config = write(dir, "packages/api/tsconfig.json", {
        extends: "@workerstack/repo/tsconfig/worker",
        include: ["src"],
      });
      write(dir, "packages/api/src/a.ts", 'const n: number = JSON.parse("1")\nconst w: string = WORKERS_STUB\n');
      expect(checkTsconfigs(dir, installed)).toEqual([]);
      const found = diagnostics(config);
      expect(found.filter((d) => d.code === 2688)).toEqual([]);
      expect(found).toEqual([UNKNOWN_TO_NUMBER]);
    },
    PROGRAM_TIMEOUT,
  );

  it("passes a tsconfig that extends a local one that extends the base", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.base.json", { extends: "@workerstack/repo/tsconfig/base", include: ["packages/*/src"] });
    write(dir, "packages/a/tsconfig.json", { extends: "../../tsconfig.base.json", include: ["src"] });
    write(dir, "packages/a/src/a.ts", "const a = 1\n");
    expect(checkTsconfigs(dir, pkgRoot)).toEqual([]);
  });

  it("passes a solution-style root that checks no code", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", { files: [], references: [{ path: "./a" }] });
    write(dir, "a/tsconfig.json", { extends: "@workerstack/repo/tsconfig/bun", include: ["src"] });
    write(dir, "a/src/a.ts", "const a = 1\n");
    expect(checkTsconfigs(dir, pkgRoot)).toEqual([]);
  });

  it("matches the package root through a symlinked install path", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", { extends: "@workerstack/repo/tsconfig/bun", include: ["src"] });
    write(dir, "src/a.ts", "const a = 1\n");
    expect(checkTsconfigs(dir, path.join(dir, "node_modules", "@workerstack", "repo"))).toEqual([]);
  });

  it("refuses a tsconfig that sets files", () => {
    const dir = consumerRepo();
    write(dir, "packages/api/tsconfig.json", {
      extends: "@workerstack/repo/tsconfig/worker",
      files: ["src/a.ts"],
    });
    write(dir, "packages/api/src/a.ts", "const a = 1\n");
    expect(checkTsconfigs(dir, pkgRoot)).toEqual([SETS_FILES("packages/api/tsconfig.json")]);
  });

  it("refuses an empty files list without references", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", { extends: "@workerstack/repo/tsconfig/bun", files: [], include: ["src"] });
    expect(checkTsconfigs(dir, pkgRoot)).toEqual([SETS_FILES("tsconfig.json")]);
  });

  it("refuses a tsconfig whose own reset.d.ts is not the base's", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", { include: ["src"] });
    write(dir, "src/reset.d.ts", '/// <reference types="@total-typescript/ts-reset" />\n');
    expect(checkTsconfigs(dir, pkgRoot)).toEqual([NO_BASE("tsconfig.json")]);
  });

  it("skips a tracked tsconfig deleted from the worktree", () => {
    const dir = consumerRepo();
    write(dir, "gone/tsconfig.json", { include: ["src"] });
    execFileSync("git", ["add", "gone/tsconfig.json"], { cwd: dir });
    fs.rmSync(path.join(dir, "gone"), { recursive: true });
    expect(checkTsconfigs(dir, pkgRoot)).toEqual([]);
  });

  it("refuses a tsconfig that extends no base", () => {
    const dir = consumerRepo();
    write(dir, "packages/web/tsconfig.json", { include: ["src"] });
    write(dir, "packages/web/src/a.ts", "const a = 1\n");
    expect(checkTsconfigs(dir, pkgRoot)).toEqual([NO_BASE("packages/web/tsconfig.json")]);
  });

  it("reports a tsconfig it cannot read with its relative path", () => {
    const dir = consumerRepo();
    write(dir, "packages/old/tsconfig.json", '{ "include": ["src"]\n');
    expect(checkTsconfigs(dir, pkgRoot)).toEqual(["tsconfig: packages/old/tsconfig.json: '}' expected."]);
  });

  it("counts an untracked tsconfig and skips an ignored one", () => {
    const dir = consumerRepo();
    write(dir, ".gitignore", "node_modules\nignored/\n");
    write(dir, "ignored/tsconfig.json", { include: ["src"] });
    write(dir, "kept/tsconfig.json", { include: ["src"] });
    expect(checkTsconfigs(dir, pkgRoot)).toEqual([NO_BASE("kept/tsconfig.json")]);
  });

  it("counts tsconfig.json and tsconfig.<name>.json only", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.app.json", { include: ["src"] });
    write(dir, "tsconfig-old.json", { include: ["src"] });
    write(dir, "jsconfig.json", { include: ["src"] });
    write(dir, "tsconfig.json.bak", { include: ["src"] });
    expect(checkTsconfigs(dir, pkgRoot)).toEqual([NO_BASE("tsconfig.app.json")]);
  });

  it("returns nothing outside a git repo", () => {
    const dir = tmp("check-tsconfig-nogit-");
    write(dir, "tsconfig.json", { include: ["src"] });
    expect(checkTsconfigs(dir, pkgRoot)).toEqual([]);
  });

  it("passes this repo's own tsconfigs", () => {
    expect(checkTsconfigs(pkgRoot, pkgRoot)).toEqual([]);
  });
});
