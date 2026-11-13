import path from "node:path";

import { expect, it } from "vitest";

import { loadEval } from "./load.ts";

const ROOT = path.join(import.meta.dirname, "__fixtures__");

it("loads a fixture eval with the defaults applied", async () => {
  const result = await loadEval(ROOT, "sample");

  if (!result.ok) throw new Error(result.message);
  const defaults = { maxTokens: 256, model: "claude-haiku-5-5", samples: 3, system: "answer briefly" };

  expect(result.spec).toMatchObject(defaults);
  expect(result.spec.cases.map((one) => one.id)).toStrictEqual(["yes", "no"]);
  expect(result.spec.cases[0]?.pass("yes")).toBe(true);
});

it("refuses a missing file", async () => {
  expect(await loadEval(ROOT, "nope")).toStrictEqual({ message: "eval: no evals/nope/eval.ts", ok: false });
});

it.each([
  ["bad-shape", "cases"],
  ["low-samples", "samples"],
  ["empty-id", "cases.0.id"],
])("refuses %s with one line naming %s", async (name, field) => {
  const result = await loadEval(ROOT, name);

  if (result.ok) throw new Error("expected an error");
  expect(result.message).toMatch(new RegExp(`^eval ${name}: ${field}: [^\\n]+$`));
});

it("refuses a duplicate case id", async () => {
  expect(await loadEval(ROOT, "duplicate")).toStrictEqual({
    message: 'eval duplicate: cases: duplicate case id "a"',
    ok: false,
  });
});

it("refuses a default export that is not an eval", async () => {
  const result = await loadEval(ROOT, "not-eval");

  if (result.ok) throw new Error("expected an error");
  expect(result.message).toMatch(/^eval not-eval: /);
});

it("loads an eval with no files as listing none, and one that lists a folder and a file", async () => {
  const sample = await loadEval(ROOT, "sample");
  const listed = await loadEval(ROOT, "with-files");

  expect(sample.ok && sample.spec.files).toStrictEqual([]);
  expect(listed.ok && listed.spec.files).toStrictEqual(["evals/sample", "evals/sample/eval.ts"]);
});

it.each([
  ["missing-file", "eval missing-file: files.0: no file or folder agents/skills/nope"],
  ["backslash-file", "eval backslash-file: files.1: use / in evals\\sample\\eval.ts"],
])("refuses %s with the line naming the listed path", async (name, message) => {
  expect(await loadEval(ROOT, name)).toStrictEqual({ message, ok: false });
});
