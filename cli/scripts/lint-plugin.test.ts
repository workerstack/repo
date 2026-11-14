import fs from "node:fs";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { BASE_CONFIG } from "../__fixtures__/base-config.ts";
import { useTempTree } from "../__fixtures__/temp-tree.ts";
import { AGENT_DEFAULTS } from "../agent-defaults.constants.ts";
import { oxlintConfig } from "../sync/oxlint-config.ts";
import { standards } from "../sync/standards.ts";
import type { PackageJson } from "../sync/workspace.ts";
import { LINT_PLUGIN_EXPECTED } from "./__fixtures__/lint-plugin-expected.ts";
import { captureTool, pluginModules } from "./lint.ts";

const SLOW = 60_000;

/** `export const wide = "` is 21 columns and `"` 1 more, so this fill makes the line 121 columns. */
const WIDE_FILL = 99;
const tree = useTempTree("workerstack-lint-plugin-");

/** A consumer with no install beside it: its manifest, config, the configs sync writes, and `files`. */
function consumer(files: Record<string, string>, manifest: PackageJson = { name: "app" }): string {
  const root = tree({});

  const ctx = {
    config: { agents: { ...AGENT_DEFAULTS, hosts: [], skills: [] }, packs: ["standards" as const], ...BASE_CONFIG },
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
    "repo.config.ts": 'export default { packs: ["standards"] };\n',
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
 * Readonly const, a cast with a reason, an ID'd TODO, a prose comment) sit beside; both module mocks report.
 */
const PLANTED = {
  ".repo/lessons/known-lesson.md": "# A lesson\n",
  "bin/app.ts": 'import { main } from "../src/main.ts";\n\nprocess.title = "app";\n\nawait main();\n',
  "src/block.ts":
    "/* an own-line comment */\nexport const block = 1;\nexport const kept = /* @__PURE__ */ Math.max(1);\n",
  "src/boundaries.ts": 'export type { ZodType as Boundaries } from "zod";\n',
  "src/cast.ts": [
    "export function cast(value: string | number): string {\n  return value as string;\n}",
    "export function old(value: string | number): string {\n  return <string>value;\n}",
    "export function kept(value: string | number): string {\n  return value /* the caller checked it */ as string;\n}",
    "export const frozen = [1] as const;\n",
  ].join("\n\n"),
  "src/clean.ts": "export const clean = 1;\n",
  "src/commented.ts":
    "// const old = load();\n\n// Prose that says why, and mentions TODO mid-sentence.\nexport const commented = 1;\n",
  "src/effects.ts":
    "export const effects = /* @__PURE__ */ make();\n\nmake();\n\nfunction make(): number {\n  return 1;\n}\n",
  "src/files.ts": "export function readWorkspace(): void {}\n",
  "src/flag.ts":
    "export function run(force: boolean): boolean {\n  return force;\n}\n\n" +
    "export function ok(options: { force: boolean }): boolean {\n  return options.force;\n}\n",
  "src/home.ts": "export function home(): string | undefined {\n  return process.env.HOME;\n}\n",
  "src/ignore.ts": "// v8 ignore next\nexport const ignore = 2;\n",
  "src/import.ts": 'import "./clean.ts";\n',
  "src/index.ts": 'export { clean } from "./clean.ts";\n\nexport const index = 1;\n',
  "src/main.ts": "export async function main(): Promise<void> {}\n",
  "src/names.ts":
    'const tail = "x";\n\nexport function names(input: string): string {\n  const PROGRAM_TIMEOUT = input;\n' +
    "  const found = PROGRAM_TIMEOUT === tail;\n\n  return found ? tail : PROGRAM_TIMEOUT;\n}\n",
  "src/native.ts": 'export function native(cwd: string): boolean {\n  return cwd.endsWith("/a");\n}\n',
  "src/old.ts": "/**\n * Replaced long ago.\n * @deprecated\n */\nexport const old = 1;\n",
  "src/order.ts": "export class Order {\n  run(): void {}\n  constructor(private readonly n: number) {}\n}\n",
  "src/parse.test.ts":
    'vi.mock(new URL("./parse.ts", import.meta.url).href);\n\nvi.mock(new URL("./store.ts", import.meta.url).href);\n',
  "src/protocol.ts": 'export type { ParsedPath as Protocol } from "path";\n',
  "src/public.ts": "export const PUBLIC = 1;\n",
  "src/skip.test.ts":
    'it.skipIf(process.platform === "win32")("on posix", () => {});\n\nit.skipIf(isCi)("on ci", () => {});\n',
  "src/state.ts":
    "let count = 0;\nexport const seen: ReadonlySet<string> = /* @__PURE__ */ new Set();\n\n" +
    "export function next(): number {\n  return ++count;\n}\n",
  "src/store.ts": "export class Store {}\n\nexport function parseRow(): void {}\n",
  "src/todo.ts": "// TODO fix\n// TODO(#12): an issue\n// TODO(known-lesson): a lesson\nexport const todo = 1;\n",
  "src/user.types.ts": "export type User = { id: string };\n\nexport const ROLES = 1;\n",
  "src/wide.ts": `export const wide = "${"x".repeat(WIDE_FILL)}"\n`,
  "vite.config.ts": 'const PLUGINS = "react";\n\nexport default { plugins: PLUGINS };\n',
};

/** The manifest beside the planted files: its bin is the planted `bin/app.ts`, its one entry `src/public.ts`. */
const MANIFEST = { bin: { app: "./bin/app.ts" }, exports: { ".": "./src/public.ts" }, name: "app" };

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

    expect([run.code, lines]).toStrictEqual([1, LINT_PLUGIN_EXPECTED]);
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
      "export function run(value: string | number): string {",
      "  /*",
      "   * Two lines,",
      "   * starred.",
      "   */",
      "  return (",
      "    value",
      "    /* the schema parsed it above */",
      "  ) as string;",
      "}",
      "",
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
  const built = oxlintConfig({ manifest: { name: "app" }, packages: [], root }, { skip: [skip] });

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
