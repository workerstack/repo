import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { LintSkip } from "../config.ts";
import { oxlintConfig } from "../sync/oxlint-config.ts";
import type { Workspace } from "../sync/workspace.ts";
import { checkLintSkips, checkLintSkipsAt, skipFiles } from "./lint-skips.ts";
import { captureTool } from "./lint.ts";

const SLOW = 60_000;
const NN = "typescript/no-non-null-assertion";
const PARAMS = "eslint/max-params";
const REASON = "the lookup result is always present";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { force: true, recursive: true });
});

/** `count` non-null assertions, one per exported function. */
const nonNull = (count: number) =>
  Array.from({ length: count }, (_, i) => `export const f${i} = (xs: string[]): string => xs.find(Boolean)!;\n`).join(
    "",
  );
const CLEAN = "export const clean = 1;\n";

/** A git checkout holding `files` and a manifest, as its workspace. */
function checkout(files: Record<string, string>): Workspace {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-skips-")));
  temps.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  const all = { "package.json": '{ "name": "app", "type": "module" }\n', ...files };
  for (const [rel, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return { manifest: { name: "app" }, packages: [], root };
}

const skip = (files: string[], rules: string[] = [NN], reason = REASON): LintSkip => ({ files, reason, rules });
const leftovers = (root: string) => fs.readdirSync(root).filter((name) => name.startsWith(".oxlintrc.unskipped-"));

it(
  "checkLintSkips reports a live skip with its rule, path, hits and reason, and a count per rule",
  { timeout: SLOW },
  () => {
    const ws = checkout({ "src/cache.ts": nonNull(1), "src/other.ts": nonNull(1) });
    expect(checkLintSkips(ws, { skip: [skip(["src/cache.ts"])] }, { scripts: [] })).toStrictEqual({
      problems: [],
      report: [`skip ${NN} in src/cache.ts: 1 hit (${REASON})`, `skips: ${NN} 1`],
    });
    expect(leftovers(ws.root)).toStrictEqual([]);
  },
);

it("checkLintSkips sums two entries on one rule and counts each rule apart, in rule order", { timeout: SLOW }, () => {
  const params =
    "export function p(a: number, b: number, c: number, d: number): number {\n  return a + b + c + d;\n}\n";
  const ws = checkout({ "lib/b.ts": `${nonNull(1)}${params}`, "src/a.ts": nonNull(2) });
  const skips = [skip(["src/*.ts"]), skip(["lib/b.ts"], [NN, PARAMS])];
  expect(checkLintSkips(ws, { skip: skips }, { scripts: [] })).toStrictEqual({
    problems: [],
    report: [
      `skip ${NN} in src/*.ts: 2 hits (${REASON})`,
      `skip ${NN} in lib/b.ts: 1 hit (${REASON})`,
      `skip ${PARAMS} in lib/b.ts: 1 hit (${REASON})`,
      `skips: ${PARAMS} 1, ${NN} 3`,
    ],
  });
});

it(
  "checkLintSkips fails a rule with no hit in its entry's files, and a glob that matches no file",
  { timeout: SLOW },
  () => {
    const ws = checkout({ "src/cache.ts": nonNull(1), "src/clean.ts": CLEAN });
    const skips = [skip(["src/cache.ts", "src/gone.ts"]), skip(["src/clean.ts"]), skip(["old/*.ts"])];
    expect(checkLintSkips(ws, { skip: skips }, { scripts: [] })).toStrictEqual({
      problems: [
        'lint.skip[0]: "src/gone.ts" matches no file; fix the path or delete the entry',
        `lint.skip[1]: ${NN} has no hit in "src/clean.ts"; delete it from the entry`,
        'lint.skip[2]: "old/*.ts" matches no file; fix the path or delete the entry',
      ],
      report: [`skip ${NN} in src/cache.ts: 1 hit (${REASON})`, `skips: ${NN} 1`],
    });
  },
);

it("checkLintSkips runs no lint when there is no skip", () => {
  const run = vi.fn(captureTool);
  expect(checkLintSkips(checkout({ "src/a.ts": nonNull(1) }), { skip: [] }, { run, scripts: [] })).toStrictEqual({
    problems: [],
    report: [],
  });
  expect(run).not.toHaveBeenCalled();
});

it("checkLintSkips lints with the skip-free config at the root and removes it after a lint that throws or fails", () => {
  const ws = checkout({ "src/a.ts": nonNull(1) });
  const unskipped = oxlintConfig(ws, { skip: [] });
  const seen: string[] = [];
  const throwing = (_tool: "oxlint" | "oxfmt", args: string[], root: string): never => {
    const config = args[args.indexOf("-c") + 1] ?? "";
    seen.push(fs.readFileSync(path.join(root, config), "utf8"));
    throw new Error("oxlint was killed");
  };
  expect(() => checkLintSkips(ws, { skip: [skip(["src/a.ts"])] }, { run: throwing, scripts: [] })).toThrow(
    "oxlint was killed",
  );
  expect(seen).toStrictEqual([unskipped.ok ? unskipped.value : ""]);
  expect(leftovers(ws.root)).toStrictEqual([]);

  const failing = () => ({ code: 2, stderr: "out of memory", stdout: "" });
  expect(checkLintSkips(ws, { skip: [skip(["src/a.ts"])] }, { run: failing, scripts: [] })).toStrictEqual({
    problems: ["oxlint exited 2: out of memory"],
    report: [],
  });
  expect(leftovers(ws.root)).toStrictEqual([]);
});

it("checkLintSkips runs no lint when no entry matches a file, and reports a checkout git cannot list", () => {
  const run = vi.fn(captureTool);
  const ws = checkout({ "src/a.ts": nonNull(1) });
  expect(checkLintSkips(ws, { skip: [skip(["old/*.ts"])] }, { run, scripts: [] })).toStrictEqual({
    problems: ['lint.skip[0]: "old/*.ts" matches no file; fix the path or delete the entry'],
    report: [],
  });
  expect(run).not.toHaveBeenCalled();
  const plain = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-skips-nogit-")));
  temps.push(plain);
  const listed = checkLintSkips({ ...ws, root: plain }, { skip: [skip(["src/a.ts"])] }, { run, scripts: [] });
  expect(listed.problems).toStrictEqual([expect.stringMatching(/^git ls-files failed: /)]);
});

it("checkLintSkipsAt checks nothing without a config, without the standards pack or with an unreadable manifest", async () => {
  const none = { problems: [], report: [] };
  const ws = checkout({ "src/a.ts": nonNull(1) });
  expect(await checkLintSkipsAt(ws.root, [])).toStrictEqual(none);
  fs.writeFileSync(path.join(ws.root, "workerstack.config.ts"), 'export default { packs: ["docs"] };\n');
  expect(await checkLintSkipsAt(ws.root, [])).toStrictEqual(none);
  const config = { lint: { skip: [skip(["src/a.ts"])] }, packs: ["standards"] };
  fs.writeFileSync(path.join(ws.root, "workerstack.config.ts"), `export default ${JSON.stringify(config)};\n`);
  fs.writeFileSync(path.join(ws.root, "package.json"), "{");
  expect(await checkLintSkipsAt(ws.root, [])).toStrictEqual(none);
});

it("checkLintSkips counts the magic hits it is handed, and fails a magic skip with none", { timeout: SLOW }, () => {
  const ws = checkout({ "src/clean.ts": CLEAN, "src/retry.ts": CLEAN });
  const line = "src/retry.ts:1:24: error repo(magic-number): 5000 names nothing; give it a named const";
  const magic = [{ file: "src/retry.ts", line, rule: "repo(magic-number)" }];
  const skips = [skip(["src/retry.ts"], ["repo/magic-number"]), skip(["src/clean.ts"], ["repo/magic-string"])];
  expect(checkLintSkips(ws, { skip: skips }, { scripts: magic })).toStrictEqual({
    problems: ['lint.skip[1]: repo/magic-string has no hit in "src/clean.ts"; delete it from the entry'],
    report: [`skip repo/magic-number in src/retry.ts: 1 hit (${REASON})`, "skips: repo/magic-number 1"],
  });
});

/** A lib package importing a ui one it declares, which only `lint.boundaries` refuses. */
function tagged(): Workspace {
  const ws = checkout({
    "packages/lib/package.json": '{ "name": "@app/lib", "dependencies": { "@app/ui": "*" } }\n',
    "packages/lib/src/lib.ts": 'export type { Ui } from "@app/ui";\n',
    "packages/ui/package.json": '{ "name": "@app/ui" }\n',
  });
  const names = ["@app/lib", "@app/ui"];
  return { ...ws, packages: names.map((name) => ({ dir: `packages/${name.slice(5)}`, manifest: { name } })) };
}
const LIB_SKIP = skip(["packages/lib/src/lib.ts"], ["repo/boundaries"]);

it("checkLintSkips counts a skipped tag hit, the tags kept in its skip-free config", { timeout: SLOW }, () => {
  const boundaries = { allow: { lib: [], ui: [] }, tags: { "@app/lib": "lib", "@app/ui": "ui" } };
  expect(checkLintSkips(tagged(), { boundaries, skip: [LIB_SKIP] }, { scripts: [] })).toStrictEqual({
    problems: [],
    report: [`skip repo/boundaries in packages/lib/src/lib.ts: 1 hit (${REASON})`, "skips: repo/boundaries 1"],
  });
});

it("checkLintSkips returns sync's error for a tag map sync refuses, and lints nothing", () => {
  const run = vi.fn<typeof captureTool>(captureTool);
  const boundaries = { allow: { lib: [] }, tags: { "@app/gone": "lib" } };
  expect(checkLintSkips(tagged(), { boundaries, skip: [LIB_SKIP] }, { run, scripts: [] })).toStrictEqual({
    problems: ['workerstack.config.ts: lint.boundaries.tags: "@app/gone" is not a workspace package'],
    report: [],
  });
  expect(run).not.toHaveBeenCalled();
});

describe("skipFiles agrees with oxlint's override matching", () => {
  const FILES = ["a.ts", "src/a.ts", "src/deep/a.ts", "lib/src/a.ts"];

  it.each(["src/**/*.ts", "*.ts", "src/*.ts", "./*.ts", "a.ts", "*/a.ts"])("%s", { timeout: SLOW }, (glob) => {
    const ws = checkout(Object.fromEntries(FILES.map((rel) => [rel, nonNull(1)])));
    const built = oxlintConfig(ws, { skip: [skip([glob])] });
    if (!built.ok) throw new Error(built.errors.join("\n"));
    fs.writeFileSync(path.join(ws.root, ".oxlintrc.json"), built.value);
    const out = captureTool("oxlint", ["-f", "json"], ws.root).stdout;
    const report = JSON.parse(out) /* oxlint's json report, as lintReport reads it */ as {
      diagnostics: { filename: string; code?: string }[];
    };
    const hit = new Set(
      report.diagnostics.filter((d) => d.code === "typescript(no-non-null-assertion)").map((d) => d.filename),
    );
    expect(skipFiles([glob], FILES)).toStrictEqual(FILES.filter((rel) => !hit.has(rel)));
  });
});
