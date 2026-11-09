import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_COMMIT } from "../config.ts";
import { standards } from "../sync/standards.ts";
import { captureTool, pluginModules } from "./lint.ts";

const SLOW = 60_000;
const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A consumer with no install beside it: its manifest, config, the configs sync writes, and `files`. */
function consumer(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-lint-plugin-"));
  temps.push(root);
  const ctx = {
    root,
    config: { packs: ["standards" as const], agents: { hosts: [], skills: [] }, commit: DEFAULT_COMMIT },
    workspace: { root, manifest: { name: "app" }, packages: [] },
    read: () => null,
  };
  const configs = standards(ctx, []).outputs.map((output): [string, string] => [
    output.path,
    output.kind === "file" ? output.content : "",
  ]);
  const all = {
    "package.json": '{ "name": "app", "type": "module" }\n',
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

/** One planted file per rule; the comments that pass (a pure call, a Readonly const) sit beside what fails. */
const PLANTED = {
  "src/boundaries.ts": 'export type { Z } from "zod";\n',
  "src/effects.ts":
    "export const store = /* @__PURE__ */ make();\nmake();\nfunction make(): object {\n  return {};\n}\n",
  "src/state.ts":
    "let count = 0;\nexport const seen: ReadonlySet<string> = /* @__PURE__ */ new Set();\nexport const next = (): number => ++count;\n",
  "src/import.ts": 'import "./clean.ts";\n',
  "src/ignore.ts": "// v8 ignore next\nexport const b = 2;\n",
  "src/protocol.ts": 'export type { ParsedPath } from "path";\n',
  "src/clean.ts": "export const a = 1;\n",
};

type Report = { diagnostics: { filename: string; code: string; message: string }[] };

it(
  "repo lint loads the plugin with no install beside the config: each planted file fails its rule, the clean one passes",
  { timeout: SLOW },
  () => {
    const root = consumer(PLANTED);
    const run = captureTool("oxlint", ["-f", "json"], root);
    const report = JSON.parse(run.stdout) as Report;
    expect([run.code, report.diagnostics.map((d) => `${d.filename} ${d.code}: ${d.message}`).sort()]).toEqual([
      1,
      [
        'src/boundaries.ts repo(boundaries): "zod" is not declared in package.json; add it to its dependencies',
        "src/effects.ts repo(no-module-side-effects): module scope runs no code; move this into a function, or mark a pure call /* @__PURE__ */",
        "src/ignore.ts repo(no-v8-ignore): coverage ignore comments hide untested code; delete the code or add a test that runs it",
        'src/import.ts repo(no-side-effect-import): import "./clean.ts" runs a module for its effects; import a function from it and call that',
        "src/protocol.ts unicorn(prefer-node-protocol): Prefer using the `node:` protocol when importing Node.js built-in modules.",
        "src/state.ts repo(no-module-state): module-scope state outlives every caller; move it into a function, or make it a const with a Readonly type",
      ],
    ]);
    expect(captureTool("oxlint", ["src/clean.ts"], root).code).toBe(0);
  },
);

it("loads the plugin when NODE_PATH is already set, the inherited dirs kept after its own", { timeout: SLOW }, () => {
  const root = consumer({ "src/state.ts": PLANTED["src/state.ts"] });
  vi.stubEnv("NODE_PATH", path.join(root, "elsewhere"));
  try {
    const run = captureTool("oxlint", ["src/state.ts"], root);
    expect([run.code, run.stdout.includes("repo(no-module-state)")]).toEqual([1, true]);
  } finally {
    vi.unstubAllEnvs();
  }
});

it.each([
  ["/app/node_modules/@workerstack/repo", "/app/node_modules"],
  ["/tmp/bunx-1000-x/node_modules/@workerstack/repo", "/tmp/bunx-1000-x/node_modules"],
  ["/src/repo", "/src/repo/node_modules"],
  ["/src/node_modules-like/repo", "/src/node_modules-like/repo/node_modules"],
])("finds the plugin for a package root %s in %s", (root, modules) => {
  expect(pluginModules(root)).toBe(modules);
});
