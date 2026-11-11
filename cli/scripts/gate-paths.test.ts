import { describe, expect, it } from "vitest";

import { camelCall, updatedInputOf } from "./fixtures/hook-payload.ts";
import { processFatTools } from "./gate-fat-tools.ts";
import type { GateResult, ToolArgs } from "./gate-harness.ts";
import { GLOB_IGNORE } from "./gate-limits.ts";
import { bashTargetsDenylist, pathIsDenied } from "./gate-paths.ts";

describe("pathIsDenied", () => {
  it("denies denylist segments, lockfiles, and .git/", () => {
    expect(pathIsDenied("node_modules/left-pad/index.js")).toBe(true);
    expect(pathIsDenied("apps/web/.next/cache")).toBe(true);
    expect(pathIsDenied("dist/index.js")).toBe(true);
    expect(pathIsDenied("coverage/lcov.info")).toBe(true);
    expect(pathIsDenied("build/out.js")).toBe(true);
    expect(pathIsDenied("bun.lock")).toBe(true);
    expect(pathIsDenied("apps/web/bun.lock")).toBe(true);
    expect(pathIsDenied(".git/objects/pack")).toBe(true);
    expect(pathIsDenied("src/index.ts")).toBe(false);
    expect(pathIsDenied(".gitignore")).toBe(false);
    expect(pathIsDenied(".github/workflows/ci.yml")).toBe(false);
  });
});

describe("bashTargetsDenylist", () => {
  it("catches cat/rg/find on denylist paths, not cargo build", () => {
    expect(bashTargetsDenylist("cat bun.lock")).toBe(true);
    expect(bashTargetsDenylist("rg foo node_modules")).toBe(true);
    expect(bashTargetsDenylist("find dist -name '*.js'")).toBe(true);
    expect(bashTargetsDenylist("cat .git/objects/pack/foo")).toBe(true);
    expect(bashTargetsDenylist("git add bun.lock")).toBe(false);
    expect(bashTargetsDenylist("git diff bun.lock")).toBe(false);
    expect(bashTargetsDenylist("cargo build")).toBe(false);
    expect(bashTargetsDenylist("cat src/index.ts")).toBe(false);
  });
});

type Run = (arg: string) => GateResult;
const nm = ["node", "modules"].join("_");
const stockDir = `${nm}/@workerstack/repo/references`;
const stockFile = `${stockDir}/plan-format.md`;
const blocked = [
  `${nm}/rulesync/package.json`,
  `${nm}/@workerstack/repo/cli/main.ts`,
  `${stockDir}/../cli/main.ts`,
  `${stockDir}/x/${nm}/y.md`,
];
const dumps = ["cat", "head", "rg x", "find"];
const win = (p: string) => `C:\\r\\${p.replaceAll("/", "\\")}`;
const denied = (r: GateResult) => r?.type === "deny";
const claude = (toolName: string, toolInput: ToolArgs) => processFatTools(camelCall(toolName, toolInput));
const cursor = (tool_name: string, tool_input: ToolArgs) =>
  processFatTools({ cursor_version: "1", tool_input, tool_name });
const shells: [string, Run][] = [
  ["claude", (command) => claude("Bash", { command })],
  ["codex", (command) => processFatTools({ model: "m", tool_input: { command }, tool_name: "bash", turn_id: "t" })],
  ["antigravity", (CommandLine) => processFatTools({ toolCall: { args: { CommandLine }, name: "RunCommand" } })],
  ["cursor", (command) => cursor("shell", { command })],
];
const tools: [string, Run][] = [
  ["claude Read", (p) => claude("Read", { file_path: p })],
  ["claude Grep", (p) => claude("Grep", { path: p, pattern: "x" })],
  ["claude Glob", (p) => claude("Glob", { path: p, pattern: "*" })],
  ["cursor Read", (p) => cursor("read", { target_file: p })],
  ["cursor Grep", (p) => cursor("grep", { path: p, pattern: "x" })],
];

it("stock references: lets Read, Grep and Glob through", () => {
  for (const [name, run] of tools) {
    expect(denied(run(stockFile)), `${name} file`).toBe(false);
    expect(denied(run(stockDir)), `${name} dir`).toBe(false);
  }
});

it("stock references: lets cat, head, rg and find run in every shell", () => {
  for (const [name, run] of shells) {
    for (const cmd of dumps) {
      expect(denied(run(`${cmd} ${stockFile}`)), `${name} ${cmd} file`).toBe(false);
      expect(denied(run(`${cmd} ${stockDir}`)), `${name} ${cmd} dir`).toBe(false);
      expect(denied(run(`${cmd} ${win(stockFile)}`)), `${name} ${cmd} windows`).toBe(false);
    }
  }
});

it("stock references: denies every other node_modules path in every tool and shell, in both spellings", () => {
  for (const target of blocked.flatMap((p) => [p, win(p)])) {
    for (const [name, run] of tools) expect(denied(run(target)), `${name} ${target}`).toBe(true);
    for (const [name, run] of shells)
      for (const cmd of dumps) expect(denied(run(`${cmd} ${target}`)), `${name} ${cmd} ${target}`).toBe(true);
  }
});

it("stock references: denies a dump that names one next to another node_modules path", () => {
  for (const [name, run] of shells) {
    expect(denied(run(`cat ${stockFile} ${nm}/rulesync/x`)), name).toBe(true);
    expect(denied(run(`cat ${stockFile}; cat "${nm}/rulesync/x"`)), name).toBe(true);
  }
});

it("stock references: a match does not hide a deny segment around it", () => {
  expect(pathIsDenied(`${["di", "st"].join("")}/${stockFile}`)).toBe(true);
  expect(pathIsDenied(`${stockFile}/../../cli`)).toBe(true);
  expect(pathIsDenied(stockFile)).toBe(false);
});

it("stock references: injects an ignore list without the dependency dir for a search rooted in them", () => {
  const rest = GLOB_IGNORE.filter((s) => s !== nm);
  const ignored = (tool: string, input: ToolArgs) => updatedInputOf(claude(tool, input));
  expect(ignored("Glob", { path: stockDir, pattern: "*" }).ignore).toStrictEqual(rest);
  expect(ignored("Glob", { pattern: "*", targetDirectory: stockDir }).ignoreGlobs).toStrictEqual(rest);
  expect(ignored("Glob", { path: "src", pattern: "*" }).ignore).toStrictEqual(GLOB_IGNORE);
  expect(JSON.stringify(ignored("Grep", { path: stockDir, pattern: "x" }))).not.toContain(`"${nm}"`);
});
