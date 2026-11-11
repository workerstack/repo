import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { BASE_CONFIG } from "../fixtures/base-config.ts";
import { oxlintConfig } from "../sync/oxlint-config.ts";
import { standards } from "../sync/standards.ts";
import type { PackageJson } from "../sync/workspace.ts";
import { captureTool, pluginModules } from "./lint.ts";

const SLOW = 60_000;
/** `export const wide = "` is 21 columns and `"` 1 more, so this fill makes the line 121 columns. */
const WIDE_FILL = 99;
const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { force: true, recursive: true });
});

/** A consumer with no install beside it: its manifest, config, the configs sync writes, and `files`. */
function consumer(files: Record<string, string>, manifest: PackageJson = { name: "app" }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-lint-plugin-"));
  temps.push(root);
  const ctx = {
    config: {
      agents: { hosts: [], skills: [] },
      packs: ["standards" as const],
      ...BASE_CONFIG,
    },
    read: () => null,
    root,
    workspace: { manifest, packages: [], root },
  };
  const configs = standards(ctx, []).outputs.map((output): [string, string] => [
    output.path,
    output.kind === "file" ? output.content : "",
  ]);
  const all = {
    "package.json": `${JSON.stringify({ ...manifest, type: "module" })}\n`,
    "workerstack.config.ts": 'export default { packs: ["standards"] };\n',
    ...Object.fromEntries(configs),
    ...files,
  };
  for (const [rel, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

/**
 * One planted file per rule, each named after its export where it has one; the forms that pass (a pure call, a
 * Readonly const, a cast with a reason, an ID'd TODO, a prose comment, a mock of another module) sit beside.
 */
const PLANTED = {
  ".repo/lessons/known-lesson.md": "# A lesson\n",
  "bin/app.ts": 'import { main } from "../src/main.ts";\n\nprocess.title = "app";\nawait main();\n',
  "src/block.ts":
    "/* an own-line comment */\nexport const block = 1;\nexport const kept = /* @__PURE__ */ Math.max(1);\n",
  "src/boundaries.ts": 'export type { ZodType as Boundaries } from "zod";\n',
  "src/cast.ts": [
    "export function cast(value: unknown): string {\n  return value as string;\n}",
    "export function old(value: unknown): string {\n  return <string>value;\n}",
    "export function kept(value: unknown): string {\n  return value /* the caller checked it */ as string;\n}",
    "export const frozen = [1] as const;\n",
  ].join("\n"),
  "src/clean.ts": "export const clean = 1;\n",
  "src/commented.ts":
    "// const old = load();\n\n// Prose that says why, and mentions TODO mid-sentence.\nexport const commented = 1;\n",
  "src/effects.ts":
    "export const effects = /* @__PURE__ */ make();\nmake();\nfunction make(): object {\n  return {};\n}\n",
  "src/files.ts": "export function readWorkspace(): void {}\n",
  "src/flag.ts": [
    "export function run(force: boolean): boolean {\n  return force;\n}",
    "export function ok(options: { force: boolean }): boolean {\n  return options.force;\n}",
    "",
  ].join("\n"),
  "src/home.ts": "export function home(): string | undefined {\n  return process.env.HOME;\n}\n",
  "src/ignore.ts": "// v8 ignore next\nexport const ignore = 2;\n",
  "src/import.ts": 'import "./clean.ts";\n',
  "src/index.ts": 'export { clean } from "./clean.ts";\nexport const index = 1;\n',
  "src/main.ts": "export async function main(): Promise<void> {}\n",
  "src/native.ts": 'export function native(cwd: string): boolean {\n  return cwd.endsWith("/a");\n}\n',
  "src/old.ts": "/**\n * Replaced long ago.\n * @deprecated\n */\nexport const old = 1;\n",
  "src/parse.test.ts":
    'vi.mock(new URL("./parse.ts", import.meta.url).href);\nvi.mock(new URL("./store.ts", import.meta.url).href);\n',
  "src/protocol.ts": 'export type { ParsedPath as Protocol } from "path";\n',
  "src/public.ts": "export const PUBLIC = 1;\n",
  "src/skip.test.ts":
    'it.skipIf(process.platform === "win32")("on posix", () => {});\nit.skipIf(isCi)("on ci", () => {});\n',
  "src/state.ts":
    "let count = 0;\nexport const seen: ReadonlySet<string> = /* @__PURE__ */ new Set();\nexport function next(): number {\n  return ++count;\n}\n",
  "src/store.ts": "export class Store {}\nexport function parseRow(): void {}\n",
  "src/todo.ts": "// TODO fix\n// TODO(#12): an issue\n// TODO(known-lesson): a lesson\nexport const todo = 1;\n",
  "src/user.types.ts": "export type User = { id: string };\nexport const ROLES = 1;\n",
  "src/wide.ts": `export const wide = "${"x".repeat(WIDE_FILL)}"\n`,
  "vite.config.ts": 'const plugins = "react";\nexport default { plugins };\n',
};
/** The manifest beside the planted files: its bin is the planted `bin/app.ts`, its one entry `src/public.ts`. */
const MANIFEST = { bin: { app: "./bin/app.ts" }, exports: { ".": "./src/public.ts" }, name: "app" };

/** What real oxlint reports over the planted files, sorted. */
const EXPECTED = [
  "bin/app.ts repo(entry-file): a bin file holds only imports and one main() call; move this into the module main comes from",
  "src/block.ts repo(no-block-comment): an own-line comment is written with //; run `bun repo lint --fix`",
  'src/boundaries.ts repo(boundaries): "zod" is not declared in package.json; add it to its dependencies',
  'src/cast.ts repo(as-needs-reason): "as string" needs a reason: write x /* why the type holds */ as string, or narrow with a check or a schema parse',
  "src/cast.ts typescript(consistent-type-assertions): Use `as string` instead of `<string>`.",
  "src/commented.ts repo(no-commented-out-code): this comment is code; delete it, git keeps the old version",
  "src/effects.ts repo(no-module-side-effects): module scope runs no code; move this into a function, or mark a pure call /* @__PURE__ */",
  'src/files.ts repo(filename-matches-export): files.ts exports only "readWorkspace"; rename the file read-workspace.ts',
  "src/flag.ts repo(no-boolean-param): `force: boolean` is a positional flag the call cannot name; " +
    "take an options object ({ force }) or split the function in two",
  "src/home.ts repo(env-in-config): process.env is read outside env.ts; add the variable to this package's env.ts schema and read it through that module",
  "src/ignore.ts repo(no-v8-ignore): coverage ignore comments hide untested code; delete the code or add a test that runs it",
  "src/import.ts import(no-unassigned-import): Imported module should be assigned",
  'src/import.ts repo(no-side-effect-import): import "./clean.ts" runs a module for its effects; import a function from it and call that',
  "src/index.ts repo(index-file): an index file only re-exports; move this into its own module and re-export it",
  'src/native.ts repo(native-path-separator): `cwd` is a native path, which uses \\ on Windows, so `.endsWith("/…")` misses there; use path.basename, path.dirname, path.relative or split(path.sep), or convert it with .replaceAll(path.sep, "/") first',
  'src/old.ts repo(deprecated-replacement): `@deprecated` names no replacement: write "use `newName` instead" or {@link newName}',
  'src/parse.test.ts repo(no-mock-of-subject): "./parse.ts" is the module this test covers; test it for real and mock what it calls',
  "src/protocol.ts unicorn(prefer-node-protocol): Prefer using the `node:` protocol when importing Node.js built-in modules.",
  'src/public.ts repo(public-jsdoc): `PUBLIC` is public through "." and has no JSDoc: add a /** */ block that says what a caller needs and the type does not',
  "src/skip.test.ts repo(skip-on-platform): skipIf reads isCi; a test may skip only on process.platform, process.arch, process.versions or a runtime global, so make it hermetic instead",
  "src/state.ts repo(no-module-state): module-scope state outlives every caller; move it into a function, or make it a const with a Readonly type",
  'src/store.ts repo(class-file): a class file holds one class, its imports and its export; move "parseRow" to its own file',
  "src/store.ts typescript(no-extraneous-class): Unexpected empty class.",
  "src/todo.ts repo(todo-needs-id): TODO needs an issue or lesson ID: TODO(#123), TODO(ABC-123) or TODO(<lesson slug>)",
  "src/user.types.ts repo(types-file): a .types.ts file holds only exported types and interfaces; move this into a module",
  "src/wide.ts repo(max-line-width): this line is 121 columns, over 120; split the string with + or a join",
  'vite.config.ts repo(config-file): a config file holds only imports and exports; move "plugins" into a module it imports',
];

/** The consumer installs no types, so `process` and `vi` are error-typed and every use of them is an unsafe-any hit. */
const UNTYPED = "typescript(no-unsafe-";

type Report = { diagnostics: { filename: string; code: string; message: string }[] };

it(
  "repo lint loads the plugin with no install beside the config: each planted file fails its rule, clean passes",
  { timeout: SLOW },
  () => {
    const root = consumer(PLANTED, MANIFEST);
    const run = captureTool("oxlint", ["-f", "json"], root);
    const report = JSON.parse(run.stdout) /* oxlint's json format has this shape */ as Report;
    const lines = report.diagnostics
      .filter((d) => !d.code.startsWith(UNTYPED))
      .map((d) => `${d.filename} ${d.code}: ${d.message}`)
      .toSorted();
    expect([run.code, lines]).toStrictEqual([1, EXPECTED]);
    expect(captureTool("oxlint", ["src/clean.ts"], root).code).toBe(0);
    expect(captureTool("oxlint", ["-f", "unix", "src/wide.ts"], root).stdout).toContain(
      "src/wide.ts:1:121: this line is 121 columns, over 120; split the string with + or a join " +
        "[Error/repo(max-line-width)]",
    );
  },
);

it(
  "oxlint --fix applies the fix of repo/no-block-comment: own-line blocks become //, inline and doc blocks stay",
  { timeout: SLOW },
  () => {
    const before = [
      "/**",
      " * A doc stays.",
      " */",
      "export function run(value: unknown): string {",
      "  /*",
      "   * Two lines,",
      "   * starred.",
      "   */",
      "  return (",
      "    value",
      "    /* the schema parsed it above */",
      "  ) as string;",
      "}",
      "export const kept = /* @__PURE__ */ Math.max(1);",
      "",
    ].join("\n");
    const root = consumer({ "src/fixed.ts": before });
    const run = captureTool("oxlint", ["--fix", "src/fixed.ts"], root);
    const after = fs.readFileSync(path.join(root, "src/fixed.ts"), "utf8");
    expect(after).toBe(
      before
        .replace("  /*\n   * Two lines,\n   * starred.\n   */", "  // Two lines,\n  // starred.")
        .replace("/* the schema parsed it above */", "// the schema parsed it above"),
    );
    expect(run.code).toBe(0);
  },
);

it("loads the plugin when NODE_PATH is already set, the inherited dirs kept after its own", { timeout: SLOW }, () => {
  const root = consumer({ "src/state.ts": PLANTED["src/state.ts"] });
  vi.stubEnv("NODE_PATH", path.join(root, "elsewhere"));
  const run = captureTool("oxlint", ["src/state.ts"], root);
  expect([run.code, run.stdout.includes("repo(no-module-state)")]).toStrictEqual([1, true]);
});

it("runs a config whose skip names only magic rules, which the plugin does not have", { timeout: SLOW }, () => {
  const root = consumer({ "src/clean.ts": PLANTED["src/clean.ts"] });
  const skip = { files: ["src/clean.ts"], reason: "retry tuning lives here", rules: ["repo/magic-number"] };
  const built = oxlintConfig({ manifest: { name: "app" }, packages: [], root }, [skip]);
  if (!built.ok) throw new Error(built.errors.join("\n"));
  fs.writeFileSync(path.join(root, ".oxlintrc.json"), built.value);
  const run = captureTool("oxlint", ["src/clean.ts"], root);
  expect([run.code, run.stderr]).toStrictEqual([0, ""]);
});

it.each([
  ["/app/node_modules/@workerstack/repo", "/app/node_modules"],
  ["/tmp/bunx-1000-x/node_modules/@workerstack/repo", "/tmp/bunx-1000-x/node_modules"],
  ["/src/repo", "/src/repo/node_modules"],
  ["/src/node_modules-like/repo", "/src/node_modules-like/repo/node_modules"],
])("finds the plugin for a package root %s in %s", (root, modules) => {
  expect(pluginModules(path.normalize(root))).toBe(path.normalize(modules));
});
