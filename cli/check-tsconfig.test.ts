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
const NO_SRC = (dir: string) =>
  `tsconfig: ${dir} has no tsconfig.src.json; add one with "extends": ["./tsconfig.json", "@workerstack/repo/tsconfig/strict"] and an "exclude" that repeats tsconfig.json's and adds the tests`;
const WEAK = (rel: string, flags: string) =>
  `tsconfig: ${rel} resolves without ${flags}; extend "@workerstack/repo/tsconfig/strict" and drop the override`;
const INCLUDES = (rel: string, file: string) =>
  `tsconfig: ${rel} includes ${file}; add "**/*.reject.ts" and "**/*.reject.tsx" to its exclude`;
const UNRUN = (rel: string) =>
  `tsconfig: ${rel} is run by no gate; delete it, or run it from a package.json script with tsc -p ${rel}`;
const STRICT_FLAGS = [
  "isolatedDeclarations",
  "erasableSyntaxOnly",
  "verbatimModuleSyntax",
  "exactOptionalPropertyTypes",
  "noUncheckedIndexedAccess",
] as const;

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { force: true, recursive: true });
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
  fs.cpSync(path.join(pkgRoot, "tsconfig"), path.join(installed, "tsconfig"), {
    recursive: true,
  });
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

/** The `tsconfig.src.json` beside `<owner>/tsconfig.json` that Usage asks for, `compilerOptions` over the strict base. */
function srcConfig(dir: string, owner: string, compilerOptions: object = {}): string {
  return write(dir, path.posix.join(owner, "tsconfig.src.json"), {
    compilerOptions,
    exclude: ["node_modules", "**/*.test.ts"],
    extends: ["./tsconfig.json", "@workerstack/repo/tsconfig/strict"],
  });
}

type Diagnostic = { code: number; file: string | undefined; text: string };

/** Every diagnostic `tsc -p <configFile>` would print, with `file` posix and relative to the config's folder. */
function diagnostics(configFile: string): Diagnostic[] {
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

const UNKNOWN_TO_NUMBER: Diagnostic = {
  code: 2322,
  file: "src/a.ts",
  text: "Type 'unknown' is not assignable to type 'number'.",
};

describe("checkTsconfigs", () => {
  it.each(["base", "bun", "worker", "web"])("passes a package that extends the %s base", (base) => {
    const dir = consumerRepo();
    write(dir, "packages/api/tsconfig.json", {
      extends: `@workerstack/repo/tsconfig/${base}`,
      include: ["src"],
    });
    srcConfig(dir, "packages/api");
    write(dir, "packages/api/src/a.ts", 'const n: number = JSON.parse("1")\n');
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
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
      expect(found.filter((d) => d.code === 2688)).toStrictEqual([]);
      expect(found).toStrictEqual([UNKNOWN_TO_NUMBER]);
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
      srcConfig(dir, "packages/api");
      write(dir, "packages/api/src/a.ts", 'const n: number = JSON.parse("1")\nconst w: string = WORKERS_STUB\n');
      expect(checkTsconfigs(dir, installed)).toStrictEqual([]);
      const found = diagnostics(config);
      expect(found.filter((d) => d.code === 2688)).toStrictEqual([]);
      expect(found).toStrictEqual([UNKNOWN_TO_NUMBER]);
    },
    PROGRAM_TIMEOUT,
  );

  it("passes a tsconfig that extends a local one that extends the base", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.base.json", {
      extends: "@workerstack/repo/tsconfig/base",
      include: ["packages/*/src"],
    });
    write(dir, "packages/a/tsconfig.json", {
      extends: "../../tsconfig.base.json",
      include: ["src"],
    });
    srcConfig(dir, "packages/a");
    write(dir, "packages/a/src/a.ts", "const a = 1\n");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });

  it("passes a solution-style root that checks no code", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", { files: [], references: [{ path: "./a" }] });
    write(dir, "a/tsconfig.json", {
      extends: "@workerstack/repo/tsconfig/bun",
      include: ["src"],
    });
    srcConfig(dir, "a");
    write(dir, "a/src/a.ts", "const a = 1\n");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });

  it("matches the package root through a symlinked install path", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", {
      extends: "@workerstack/repo/tsconfig/bun",
      include: ["src"],
    });
    srcConfig(dir, ".");
    write(dir, "src/a.ts", "const a = 1\n");
    expect(checkTsconfigs(dir, path.join(dir, "node_modules", "@workerstack", "repo"))).toStrictEqual([]);
  });

  it("refuses a tsconfig that sets files", () => {
    const dir = consumerRepo();
    write(dir, "packages/api/tsconfig.json", {
      extends: "@workerstack/repo/tsconfig/worker",
      files: ["src/a.ts"],
    });
    write(dir, "packages/api/src/a.ts", "const a = 1\n");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([
      SETS_FILES("packages/api/tsconfig.json"),
      NO_SRC("packages/api"),
    ]);
  });

  it("refuses an empty files list without references", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", {
      extends: "@workerstack/repo/tsconfig/bun",
      files: [],
      include: ["src"],
    });
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([SETS_FILES("tsconfig.json"), NO_SRC(".")]);
  });

  it("refuses a tsconfig whose own reset.d.ts is not the base's", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", { include: ["src"] });
    write(dir, "src/reset.d.ts", '/// <reference types="@total-typescript/ts-reset" />\n');
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([NO_BASE("tsconfig.json"), NO_SRC(".")]);
  });

  it("skips a tracked tsconfig deleted from the worktree", () => {
    const dir = consumerRepo();
    write(dir, "gone/tsconfig.json", { include: ["src"] });
    execFileSync("git", ["add", "gone/tsconfig.json"], { cwd: dir });
    fs.rmSync(path.join(dir, "gone"), { recursive: true });
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });

  it("refuses a tsconfig that extends no base", () => {
    const dir = consumerRepo();
    write(dir, "packages/web/tsconfig.json", { include: ["src"] });
    write(dir, "packages/web/src/a.ts", "const a = 1\n");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([NO_BASE("packages/web/tsconfig.json"), NO_SRC("packages/web")]);
  });

  it("reports a tsconfig it cannot read with its relative path", () => {
    const dir = consumerRepo();
    write(dir, "packages/old/tsconfig.json", '{ "include": ["src"]\n');
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual(["tsconfig: packages/old/tsconfig.json: '}' expected."]);
  });

  it("counts an untracked tsconfig and skips an ignored one", () => {
    const dir = consumerRepo();
    write(dir, ".gitignore", "node_modules\nignored/\n");
    write(dir, "ignored/tsconfig.json", { include: ["src"] });
    write(dir, "kept/tsconfig.json", { include: ["src"] });
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([NO_BASE("kept/tsconfig.json"), NO_SRC("kept")]);
  });

  it("counts tsconfig.json and tsconfig.<name>.json only", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.app.json", { include: ["src"] });
    write(dir, "tsconfig-old.json", { include: ["src"] });
    write(dir, "jsconfig.json", { include: ["src"] });
    write(dir, "tsconfig.json.bak", { include: ["src"] });
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([NO_BASE("tsconfig.app.json"), UNRUN("tsconfig.app.json")]);
  });

  it("refuses a tsconfig.json without a tsconfig.src.json beside it, at the root and in a package", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", {
      extends: "@workerstack/repo/tsconfig/bun",
      include: ["src"],
    });
    write(dir, "packages/api/tsconfig.json", {
      extends: "@workerstack/repo/tsconfig/bun",
      include: ["src"],
    });
    write(dir, "packages/web/tsconfig.json", {
      extends: "@workerstack/repo/tsconfig/web",
      include: ["src"],
    });
    srcConfig(dir, "packages/web");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([NO_SRC("packages/api"), NO_SRC(".")]);
  });

  it.each(STRICT_FLAGS)("refuses a tsconfig.src.json that turns %s off", (flag) => {
    const dir = consumerRepo();
    write(dir, "packages/api/tsconfig.json", {
      extends: "@workerstack/repo/tsconfig/bun",
      include: ["src"],
    });
    srcConfig(dir, "packages/api", { [flag]: false });
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([WEAK("packages/api/tsconfig.src.json", flag)]);
  });

  it("names every flag a tsconfig.src.json without the strict base resolves without", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", {
      extends: "@workerstack/repo/tsconfig/bun",
      include: ["src"],
    });
    write(dir, "tsconfig.src.json", {
      exclude: ["**/*.test.ts"],
      extends: "./tsconfig.json",
    });
    const missing = STRICT_FLAGS.filter((flag) => flag !== "noUncheckedIndexedAccess").join(", ");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([WEAK("tsconfig.src.json", missing)]);
  });

  it("passes a tsconfig.json with its strict tsconfig.src.json", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", {
      extends: "@workerstack/repo/tsconfig/bun",
      include: ["src"],
    });
    srcConfig(dir, ".");
    write(dir, "src/a.ts", "export const f = () => 1\n");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });

  it("refuses a tsconfig.json and tsconfig.src.json that include a reject file, until both exclude it", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", {
      extends: "@workerstack/repo/tsconfig/bun",
      include: ["src"],
    });
    srcConfig(dir, ".");
    write(dir, "src/user.ts", "export const a = 1\n");
    write(dir, "src/user.reject.ts", "export const b: number = 'x'\n");
    write(dir, "src/view.reject.tsx", "export const c: number = 'x'\n");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([
      INCLUDES("tsconfig.json", "src/user.reject.ts"),
      INCLUDES("tsconfig.json", "src/view.reject.tsx"),
      INCLUDES("tsconfig.src.json", "src/user.reject.ts"),
      INCLUDES("tsconfig.src.json", "src/view.reject.tsx"),
    ]);
    const exclude = ["**/*.reject.ts", "**/*.reject.tsx"];
    write(dir, "tsconfig.json", {
      exclude,
      extends: "@workerstack/repo/tsconfig/bun",
      include: ["src"],
    });
    write(dir, "tsconfig.src.json", {
      exclude: [...exclude, "**/*.test.ts"],
      extends: ["./tsconfig.json", "@workerstack/repo/tsconfig/strict"],
    });
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });

  it("returns nothing outside a git repo", () => {
    const dir = tmp("check-tsconfig-nogit-");
    write(dir, "tsconfig.json", { include: ["src"] });
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });

  it("passes this repo's own tsconfigs", () => {
    expect(checkTsconfigs(pkgRoot, pkgRoot)).toStrictEqual([]);
  });
});

/** A config extending the bun base, which has nothing to report but whether a gate runs it. */
function plainConfig(dir: string, rel: string, extra: object = {}): void {
  write(dir, rel, {
    extends: "@workerstack/repo/tsconfig/bun",
    include: ["src"],
    ...extra,
  });
}

function script(dir: string, rel: string, command: string): void {
  write(dir, rel, { name: "pkg", scripts: { typecheck: command } });
}

describe("checkTsconfigs runs", () => {
  it("refuses a tsconfig no gate runs", () => {
    const dir = consumerRepo();
    plainConfig(dir, "tsconfig.old.json");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([UNRUN("tsconfig.old.json")]);
  });

  it("names the config by its repo-relative posix path", () => {
    const dir = consumerRepo();
    plainConfig(dir, "packages/api/tsconfig.old.json");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([UNRUN("packages/api/tsconfig.old.json")]);
  });

  it.each([
    "tsc -p tsconfig.old.json",
    "tsc -p ./tsconfig.old.json",
    "tsc --project=tsconfig.old.json",
    "tsc --noEmit --project tsconfig.old.json && echo ok",
  ])("passes a tsconfig a script runs with %s", (command) => {
    const dir = consumerRepo();
    plainConfig(dir, "tsconfig.old.json");
    script(dir, "package.json", command);
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });
});

describe("checkTsconfigs script runs", () => {
  it("reads -p of a folder as that folder's tsconfig.json, not its other configs", () => {
    const dir = consumerRepo();
    plainConfig(dir, "tools/tsconfig.old.json");
    script(dir, "package.json", "tsc -p tools");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([UNRUN("tools/tsconfig.old.json")]);
  });

  it("resolves a nested package's script from that package's own folder", () => {
    const dir = consumerRepo();
    plainConfig(dir, "packages/a/tsconfig.old.json");
    script(dir, "packages/a/package.json", "tsc -p tsconfig.old.json");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });

  it("does not resolve a script's path from another folder", () => {
    const dir = consumerRepo();
    plainConfig(dir, "packages/a/tsconfig.old.json");
    script(dir, "package.json", "tsc -p tsconfig.old.json");
    write(dir, "packages/a/package.json", { name: "a" });
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([UNRUN("packages/a/tsconfig.old.json")]);
  });
});

describe("checkTsconfigs extends and references", () => {
  it("passes a base that run configs extend, through a chain and an extends array", () => {
    const dir = consumerRepo();
    plainConfig(dir, "tsconfig.base.json");
    write(dir, "tsconfig.mid.json", { extends: "./tsconfig.base.json" });
    write(dir, "tsconfig.json", {
      extends: ["@workerstack/repo/tsconfig/bun", "./tsconfig.mid.json"],
      include: ["src"],
    });
    srcConfig(dir, ".");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });

  it("refuses a base that only an unrun config extends", () => {
    const dir = consumerRepo();
    plainConfig(dir, "tsconfig.base.json");
    write(dir, "tsconfig.old.json", { extends: "./tsconfig.base.json" });
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([UNRUN("tsconfig.base.json"), UNRUN("tsconfig.old.json")]);
  });
});

describe("checkTsconfigs extends and scripts of other shapes", () => {
  it("follows an extends written with or without .json and skips an extends of a package", () => {
    const dir = consumerRepo();
    plainConfig(dir, "tsconfig.base.json");
    plainConfig(dir, "tsconfig.other.json");
    write(dir, "tsconfig.json", {
      extends: ["@workerstack/repo/tsconfig/bun", "./tsconfig.base.json", "./tsconfig.other"],
      include: ["src"],
    });
    srcConfig(dir, ".");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });

  it("ignores a script block that is not an object and a script that is not a string", () => {
    const dir = consumerRepo();
    plainConfig(dir, "tsconfig.old.json");
    write(dir, "package.json", { name: "pkg", scripts: "tsc -p tsconfig.old.json" });
    write(dir, "packages/a/package.json", { name: "a", scripts: { typecheck: 1 } });
    write(dir, "packages/b/package.json", { name: "b", scripts: null });
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([UNRUN("tsconfig.old.json")]);
  });
});

describe("checkTsconfigs references", () => {
  it("passes configs a solution config references", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", {
      files: [],
      references: [{ path: "./a/tsconfig.app.json" }, { path: "./b" }],
    });
    plainConfig(dir, "a/tsconfig.app.json");
    plainConfig(dir, "b/tsconfig.json");
    srcConfig(dir, "b");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });

  it("ignores a reference that is not an object or has no string path", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", { files: [], references: ["./a", { path: 1 }, { path: "./a" }] });
    plainConfig(dir, "a/tsconfig.json");
    srcConfig(dir, "a");
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });

  it("passes tsconfig.json with its tsconfig.src.json and a solution config alone", () => {
    const dir = consumerRepo();
    write(dir, "tsconfig.json", { files: [], references: [] });
    expect(checkTsconfigs(dir, pkgRoot)).toStrictEqual([]);
  });
});
