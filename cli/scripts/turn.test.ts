import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import type { Captured } from "./lint.ts";
import type { Bins } from "./turn-steps.ts";
import {
  cleanTemps,
  PKG_ROOT,
  SLOW,
  git,
  write,
  read,
  consumer,
  turn,
  staged,
  unstaged,
} from "./fixtures/turn-repo.ts";

afterEach(cleanTemps);

const TSCONFIG = `{\n  "extends": ${JSON.stringify(path.join(PKG_ROOT, "tsconfig/bun.json"))},\n  "include": ["src"]\n}\n`;
const PIN = `bun@${Bun.version}`;
const APP_MANIFEST = `${JSON.stringify({ name: "app", type: "module", private: true, sideEffects: false, packageManager: PIN })}\n`;
const ANSWER = "export const answer = 42;\n";
const ANSWER_TEST =
  'import { expect, it } from "vitest";\nimport { answer } from "./answer.ts";\n\nit("answers", () => {\n  expect(answer).toBe(42);\n});\n';

it("a clean tree has no changes", { timeout: SLOW }, async () => {
  expect(await turn(consumer({}), [])).toEqual({ code: 0, out: "turn: no changes\n", err: "" });
});

it(
  "the working tree: formats, lints, typechecks the root, runs the related tests and leaves the index alone",
  { timeout: SLOW },
  async () => {
    const root = consumer({ "tsconfig.json": TSCONFIG, "src/answer.ts": ANSWER, "src/answer.test.ts": ANSWER_TEST });
    write(root, { "src/answer.ts": "export const answer = 40+2\n", "src/other.ts": "export const other = 1;\n" });
    expect(await turn(root, [])).toEqual({
      code: 0,
      out: "turn: 2 files · fmt 1 fixed · comments ok · lint ok · typecheck . · 1 related test passed\n",
      err: "",
    });
    expect(read(root, "src/answer.ts")).toBe("export const answer = 40 + 2;\n");
    expect(staged(root)).toEqual([]);
  },
);

it("--staged refuses a file with staged and unstaged changes before running anything", { timeout: SLOW }, async () => {
  const root = consumer({ "src/a.ts": "export const a = 1;\n" });
  write(root, { "src/a.ts": "export const a = {b:1}\n" });
  git(root, "add", "src/a.ts");
  write(root, { "src/a.ts": "export const a = {b:2}\n" });
  expect(await turn(root, ["--staged"])).toEqual({
    code: 1,
    out: "",
    err: "repo turn: src/a.ts has staged and unstaged changes; stage the rest (git add src/a.ts) or undo it\n",
  });
  expect(read(root, "src/a.ts")).toBe("export const a = {b:2}\n");
});

it("--staged restages what fmt fixed, and an unstaged file stays out", { timeout: SLOW }, async () => {
  const root = consumer({ "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 1;\n" });
  write(root, { "src/a.ts": "export const a = {b:1}\n", "src/b.ts": "export const b = {c:1}\n" });
  git(root, "add", "src/a.ts");
  const result = await turn(root, ["--staged"]);
  expect(result.out).toMatch(/^turn: 1 file · fmt 1 fixed · comments ok · lint ok · /);
  expect(result.code).toBe(0);
  expect(staged(root)).toEqual(["src/a.ts"]);
  expect(unstaged(root)).toEqual(["src/b.ts"]);
  expect(git(root, "show", ":src/a.ts")).toBe("export const a = { b: 1 };\n");
  expect(read(root, "src/b.ts")).toBe("export const b = {c:1}\n");
});

it("a manifest change runs sync and check; a references change runs sync alone", { timeout: SLOW }, async () => {
  const root = consumer({ "references/a.md": "# A\n" });
  write(root, { "package.json": APP_MANIFEST });
  const manifest = await turn(root, []);
  expect(manifest.out).toMatch(/ · sync ok · check ok\n$/);
  expect(manifest.code).toBe(0);
  git(root, "checkout", "--", "package.json");
  fs.rmSync(path.join(root, "references/a.md"));
  const references = await turn(root, []);
  expect(references.out).toMatch(/^turn: 1 file · fmt ok · .* · sync ok\n$/);
});

it("--staged restages what lint --fix and sync rewrote, the fix formatted", { timeout: SLOW }, async () => {
  const root = consumer({ "src/a.ts": "export const a = 1;\n" });
  const attributes = read(root, ".gitattributes");
  write(root, {
    "src/a.ts": "export function a(n: number) {\n  if (n) {\n    return 1;\n  } else {\n    return 2;\n  }\n}\n",
    "package.json": APP_MANIFEST,
    ".gitattributes": `${attributes}*.bin binary\n`.replace("eol=lf", "eol=crlf"),
  });
  git(root, "add", "src/a.ts", "package.json", ".gitattributes");
  const result = await turn(root, ["--staged"]);
  expect(result.out).toMatch(/^turn: 3 files · fmt 1 fixed · comments ok · lint ok · .* · sync ok · check ok\n$/);
  expect(git(root, "show", ":src/a.ts")).toBe(
    "export function a(n: number) {\n  if (n) {\n    return 1;\n  }\n  return 2;\n}\n",
  );
  expect(git(root, "show", ":.gitattributes")).toBe(`${attributes}*.bin binary\n`);
  expect(unstaged(root)).toEqual([]);
});

it("a sync refusal fails sync and check and prints their output", { timeout: SLOW }, async () => {
  const root = consumer({});
  write(root, { "src/.gitignore": "x\n", "package.json": APP_MANIFEST });
  const result = await turn(root, []);
  expect(result.out).toMatch(/ · sync failed · check failed\n$/);
  expect(result.err).toContain("repo sync: src/.gitignore: ignore rules live in the root .gitignore");
  expect(result.code).toBe(1);
});

it("a path is the whole package owning it, typechecked on its own tsconfig", { timeout: SLOW }, async () => {
  const root = consumer({
    "package.json": `${JSON.stringify({ name: "app", type: "module", private: true, workspaces: ["packages/*"], packageManager: PIN })}\n`,
    "packages/api/package.json": `${JSON.stringify({ name: "api", type: "module", private: true, sideEffects: false }, null, 2)}\n`,
    "packages/api/tsconfig.json": TSCONFIG,
    "packages/api/src/a.ts": "export const a = 42;\n",
    "packages/api/src/b.ts": "export const b = 42;\n",
    "src/root.ts": "export const root = 42;\n",
  });
  const calls: string[] = [];
  const called = (bin: string, args: string[], cwd: string) =>
    calls.push(`${bin} ${path.relative(root, cwd) || "."} ${args.join(" ")}`);
  const bins: Bins = {
    tsc: (args, cwd) => (called("tsc", args, cwd), { code: 0, stdout: "", stderr: "" }),
    vitest: (args, cwd) => (called("vitest", args, cwd), null),
  };
  const result = await turn(root, ["packages/api/src"], bins);
  expect(result.out).toBe(
    "turn: 4 files · fmt ok · comments ok · lint ok · typecheck packages/api · related tests skipped (no vitest in packages/api) · sync ok · check ok\n",
  );
  expect(calls).toEqual([
    "tsc . --noEmit -p packages/api",
    "vitest packages/api related --run --passWithNoTests src/a.ts src/b.ts",
  ]);
});

it("a failing typecheck and failing tests print their output and fail the turn", { timeout: SLOW }, async () => {
  const root = consumer({ "tsconfig.json": TSCONFIG, "src/a.ts": "export const a = 42;\n" });
  write(root, { "src/a.ts": "export const a = 41;\n" });
  const bins: Bins = {
    tsc: (): Captured => ({ code: 2, stdout: "src/a.ts(1,7): error TS2322: no.\n", stderr: "" }),
    vitest: (): Captured => ({ code: 1, stdout: " Tests  1 failed | 3 passed (4)\n", stderr: "" }),
  };
  const result = await turn(root, [], bins);
  expect(result.out).toBe(
    "turn: 1 file · fmt ok · comments ok · lint ok · typecheck failed (.) · 4 related tests, 1 failed\n",
  );
  expect(result.err).toBe("src/a.ts(1,7): error TS2322: no.\n Tests  1 failed | 3 passed (4)\n");
  expect(result.code).toBe(1);
});

it(
  "refuses unknown flags, --staged with a path, and a repo without the standards pack",
  { timeout: SLOW },
  async () => {
    const root = consumer({});
    expect(await turn(root, ["--nope"])).toEqual({
      code: 1,
      out: "",
      err: "repo turn: unknown flag --nope; use repo turn [--staged] [<path>]\n",
    });
    expect((await turn(root, ["--staged", "src"])).err).toBe(
      "repo turn: --staged gates the index, a path gates a package; pass one\n",
    );
    write(root, { "workerstack.config.ts": 'export default { packs: ["docs"] };\n' });
    expect((await turn(root, [])).err).toBe(
      'repo turn: the standards pack is off; add "standards" to packs in workerstack.config.ts\n',
    );
  },
);
