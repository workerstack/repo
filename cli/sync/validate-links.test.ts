import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { file, link } from "./__fixtures__/outputs-kit.ts";
import { tempDir, useTempDirs } from "./__fixtures__/temp-dirs.ts";
import { validateOutputs } from "./validate-outputs.ts";

useTempDirs();

function tmpRoot(): string {
  return tempDir("workerstack-validate-");
}

it("accepts a link to a path on disk, relative or absolute", () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, "agents/skills/ask"), { recursive: true });
  const outputs = [
    link(".agents/skills/ask", "../../agents/skills/ask"),
    link(".agents/skills/abs", path.join(root, "agents/skills/ask")),
  ];
  expect(validateOutputs(root, outputs)).toStrictEqual([]);
});

it("reports a dangling link", () => {
  expect(validateOutputs(tmpRoot(), [link(".agents/skills/ask", "../../agents/skills/ask")])).toStrictEqual([
    ".agents/skills/ask: link target ../../agents/skills/ask does not exist",
  ]);
});

it("reports a link that leaves the repo for a missing path", () => {
  const lines = validateOutputs(tmpRoot(), [link("a/b", "../../../no-such-dir-workerstack")]);
  expect(lines).toStrictEqual(["a/b: link target ../../../no-such-dir-workerstack does not exist"]);
});

it("follows a link whose target is another planned link into an existing dir", () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, ".repo/skills/x"), { recursive: true });
  const outputs = [
    link(".claude/skills/x", "../../.agents/skills/x"),
    link(".agents/skills/x", "../../.repo/skills/x"),
  ];
  expect(validateOutputs(root, outputs)).toStrictEqual([]);
  expect(validateOutputs(root, outputs.toReversed())).toStrictEqual([]);
});

it("reports a chain of planned links that ends in nothing", () => {
  const outputs = [
    link(".claude/skills/x", "../../.agents/skills/x"),
    link(".agents/skills/x", "../../.repo/skills/x"),
  ];
  expect(validateOutputs(tmpRoot(), outputs)).toStrictEqual([
    ".claude/skills/x: link target ../../.agents/skills/x does not exist",
    ".agents/skills/x: link target ../../.repo/skills/x does not exist",
  ]);
});

it("reports planned links that point at each other", () => {
  const outputs = [link("a", "b"), link("b", "a")];
  expect(validateOutputs(tmpRoot(), outputs)).toStrictEqual([
    "a: link target b does not exist",
    "b: link target a does not exist",
  ]);
});

it("accepts a link into a planned dir that is not on disk yet", () => {
  const outputs = [link(".claude/skills/x", "../../.codex/agents"), file(".codex/agents/a.toml", 'name = "a"\n')];
  expect(validateOutputs(tmpRoot(), outputs)).toStrictEqual([]);
});

it("checks files against the formats it is given", () => {
  const formats = [{ comment: null, format: "text" as const, match: () => true }];
  expect(validateOutputs(tmpRoot(), [file("docs/x.yaml", "a: 1\n")], formats)).toStrictEqual([]);
});
