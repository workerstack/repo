import { execFileSync } from "node:child_process";

import { afterEach, expect, it } from "vitest";

import type { WorkerstackConfig } from "./config.ts";
import { fakeRunner } from "./css/__fixtures__/css-kit.ts";
import { cleanTemps, hit, NAMES_NOTHING, NUMBER, plant, SLOW } from "./magic/__fixtures__/magic-repo.ts";
import { checkRejectionsAt, checkScriptsAt, scriptDiagnostics, scriptLintAt } from "./script-diagnostics.ts";
import { cleanTemps as cleanRunners } from "./scripts/__fixtures__/turn-repo.ts";

afterEach(() => {
  cleanTemps();
  cleanRunners();
});

const GUARD = "repo(guard-rejects)";

function untested(name: string) {
  return `${name} is never asserted false; add expect(${name}(<an input it must reject>)).toBe(false) to a test`;
}

it("scriptDiagnostics joins the magic hits and the untested guards, in file and line order", { timeout: SLOW }, () => {
  const source =
    "export const isList = (value: unknown): value is unknown[] => Array.isArray(value);\n" +
    "export const n = (): number => 7;\n";

  const root = plant({ "src/a.ts": source });
  expect(scriptDiagnostics(root, { files: ["src/a.ts"], sources: ["src/a.ts"] })).toStrictEqual({
    ok: true,
    value: [hit("src/a.ts:1:14", GUARD, untested("isList")), hit("src/a.ts:2:32", NUMBER, NAMES_NOTHING("7"))],
  });
});

it("scriptDiagnostics reports a tsconfig.json that only the guards read, over a test file", { timeout: SLOW }, () => {
  const root = plant({ "pkg/a.test.ts": "export {};\n", "pkg/tsconfig.json": "{" });
  const found = scriptDiagnostics(root, { files: ["pkg/a.test.ts"], sources: ["pkg/a.test.ts"] });
  expect(found.ok ? [] : found.error).toStrictEqual([expect.stringMatching(/^pkg\/tsconfig\.json: .+/)]);
});

it("scriptDiagnostics returns jscpd's missing binary for a platform it ships none for", () => {
  const root = plant({ "src/a.ts": "export const a = 1;\n" });

  const found = scriptDiagnostics(
    root,
    { files: ["src/a.ts"], sources: ["src/a.ts"] },
    {
      fix: false,
      target: { arch: "x64", platform: "freebsd" },
    },
  );

  expect(found.ok ? [] : found.error).toStrictEqual([
    expect.stringMatching(/^jscpd has no binary .+jscpd-freebsd-x64/),
  ]);
});

it("scriptDiagnostics returns why Stylelint could not lint a sheet", () => {
  const runner = fakeRunner({ code: 1, stderr: "Error: no config\n    at load\n", stdout: "" });
  const root = plant({ "src/a.ts": "export const a = 1;\n" });
  const found = scriptDiagnostics(root, { files: ["src/a.css"], sources: [] }, { fix: false, runner });
  expect(found).toStrictEqual({ error: ["stylelint could not run: Error: no config"], ok: false });
});

/** A git checkout with a config of `packs` and `skip`, and `files`. */
function checkout(files: Record<string, string>, config: WorkerstackConfig): string {
  const root = plant({ ...files, "workerstack.config.ts": `export default ${JSON.stringify(config)};\n` });
  execFileSync("git", ["init", "-q"], { cwd: root });

  return root;
}

it("checkScriptsAt gives every hit of the checkout and those its skips leave", async () => {
  const skip = { files: ["src/a.ts"], reason: "tuning lives here", rules: ["repo/magic-number"] };

  const root = checkout(
    { "src/a.ts": "export const f = () => 5000;\n", "src/b.ts": "export const g = () => 7;\n" },
    { lint: { skip: [skip] }, packs: ["standards"] },
  );

  const a = hit("src/a.ts:1:24", NUMBER, NAMES_NOTHING("5000"));
  const b = hit("src/b.ts:1:24", NUMBER, NAMES_NOTHING("7"));
  expect(await checkScriptsAt(root)).toStrictEqual({ all: [a, b], kept: [b], problems: [] });
});

it("checkScriptsAt checks nothing without a config or the standards pack, and reports what stops it", async () => {
  const none = { all: [], kept: [], problems: [] };
  expect(await checkScriptsAt(plant({ "src/a.ts": "export const f = () => 5;\n" }))).toStrictEqual(none);
  const docs = checkout({ "src/a.ts": "export const f = () => 5;\n" }, { packs: ["docs"] });
  expect(await checkScriptsAt(docs)).toStrictEqual(none);

  const broken = checkout(
    { "pkg/a.ts": "export const f = () => 5;\n", "pkg/tsconfig.json": "{" },
    { packs: ["standards"] },
  );

  const brokenChecked = await checkScriptsAt(broken);
  expect(brokenChecked.problems).toStrictEqual([expect.stringMatching(/^pkg\/tsconfig\.json: .+/)]);
  const plain = plant({ "workerstack.config.ts": 'export default { packs: ["standards"] };\n' });
  const plainChecked = await checkScriptsAt(plain);
  expect(plainChecked.problems).toStrictEqual([expect.stringMatching(/^git ls-files failed: /)]);
});

it("scriptLintAt prints no line when the script checks cannot run, only what stops them", async () => {
  const broken = checkout(
    { "pkg/a.ts": "export const f = () => 5;\n", "pkg/tsconfig.json": "{" },
    { packs: ["standards"] },
  );

  expect(await scriptLintAt(broken, { clippy: false, paths: null })).toStrictEqual({
    lines: [],
    problems: [expect.stringMatching(/^pkg\/tsconfig\.json: .+/)],
  });
});

it(
  "checkRejectionsAt checks every reject file of a standards checkout, and nothing without the pack",
  { timeout: SLOW },
  async () => {
    const files = {
      "src/a.reject.ts": "export const a: number = 'x';\n",
      "src/b.ts": "export const b: number = 'x';\n",
    };

    expect(await checkRejectionsAt(checkout(files, { packs: ["standards"] }))).toStrictEqual([
      "src/a.reject.ts: line 1 fails unmarked: TS2322: Type 'string' is not assignable to type 'number'.",
    ]);
    expect(await checkRejectionsAt(checkout(files, { packs: ["docs"] }))).toStrictEqual([]);
    expect(await checkRejectionsAt(plant(files))).toStrictEqual([]);
    const plain = plant({ "workerstack.config.ts": 'export default { packs: ["standards"] };\n' });
    expect(await checkRejectionsAt(plain)).toStrictEqual([expect.stringMatching(/^git ls-files failed: /)]);
  },
);
