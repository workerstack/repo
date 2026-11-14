import { describe, expect, it } from "vitest";

import { camelCall, updatedInputOf } from "./__fixtures__/hook-payload.ts";
import { processFatTools } from "./gate-fat-tools.ts";
import type { GateResult, ToolArgs } from "./gate-harness.ts";
import { GLOB_IGNORE } from "./gate-limits.ts";
import { bashTargetsDenylist, pathIsDenied } from "./gate-paths.ts";

/** A dir that does not exist, so a glob in a command matches nothing, as in an empty dir. */
const NO_DIR = "/no-such-gate-dir";

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
    expect(bashTargetsDenylist("cat bun.lock", NO_DIR)).toBe(true);
    expect(bashTargetsDenylist("rg foo node_modules", NO_DIR)).toBe(true);
    expect(bashTargetsDenylist("find dist -name '*.js'", NO_DIR)).toBe(true);
    expect(bashTargetsDenylist("cat .git/objects/pack/foo", NO_DIR)).toBe(true);
    expect(bashTargetsDenylist("git add bun.lock", NO_DIR)).toBe(false);
    expect(bashTargetsDenylist("git diff bun.lock", NO_DIR)).toBe(false);
    expect(bashTargetsDenylist("cargo build", NO_DIR)).toBe(false);
    expect(bashTargetsDenylist("cat src/index.ts", NO_DIR)).toBe(false);
  });
});

/** Commands that hand a bare denied dir name to a command that dumps nothing. */
const passes = [
  "bun repo coverage 2>&1 | tail -5",
  "bun run build | head -20",
  'bun repo changelog add Fixed "repo coverage takes a timeout" && git log | head -3',
  "ls dist; cat src/a.ts",
  'echo "coverage | head" | cat',
];

/** Commands that dump a denied path: bare, quoted, redirected, wrapped or nested. */
const denies = [
  "head -5 dist",
  'head -5 "dist"',
  "cat <coverage",
  "cat coverage",
  "grep -E 'a|b' dist",
  "bun x coverage/lcov.info | head",
  "ls | xargs grep foo build",
  "sudo -u root cat build",
  "timeout 5 cat dist",
  "xargs -I {} cat build",
  "nice -n 10 head dist",
  "sh -c 'cat dist'",
  "cd x && find build -name a",
  'echo "$(cat dist/x)"',
  "cat 'dist",
  "/usr/bin/cat dist",
  "C:\\tools\\grep.exe x build",
];

const nmDir = ["node", "modules"].join("_");

/** A search pattern or a find name-test value that spells a denied name: never opened, so it passes. */
const patterns = [
  `rg -n ${nmDir} cli`,
  "ls | grep -v dist",
  "grep -rn --fixed-strings coverage docs",
  `find . -name ${nmDir} -prune -o -name '*.ts' -print`,
  "find . -name .git -prune",
  "fd -H build src",
  "rg -n bun.lock cli",
  "grep -in --color=never -- build src",
  `C:\\tools\\rg.exe -- ${nmDir}`,
  `find . -exec echo {} + -name ${nmDir}`,
  `find . -exec echo {} ';' -iname dist`,
  "rg -n -- build src",
];

/** Words a search may open, beside or around a pattern: still judged, so each is denied. */
const stillDenied = [
  `rg foo ${nmDir}`,
  "grep -e x dist",
  "rg -f build cli",
  "rg --files coverage",
  "find dist -name x",
  "xargs grep foo build",
  "grep < bun.lock x",
  'F=bun.lock; cat "$F"',
  `rg "$(cat ${nmDir}/a/package.json)" cli`,
  `rg -n -e x ${nmDir}`,
  `rg ${nmDir} cli -e x`,
  "grep --reg=x dist",
  `rg -g x ${nmDir} cli`,
  "grep -A 3 x dist",
  "grep --line x dist",
  `find . -exec grep -name ${nmDir} {} \\;`,
  `grep <${nmDir}/a/b.js foo`,
  "grep -n -- <dist",
  "rg -n <dist",
  "grep - coverage",
  "grep -- x dist",
  "fd --exclude x build",
  "find dist -name",
  "grep x src; <dist/a",
];

it("bashTargetsDenylist: passes a pattern that spells a denied name", () => {
  for (const cmd of patterns) expect(bashTargetsDenylist(cmd, NO_DIR), cmd).toBe(false);
});

it("bashTargetsDenylist: still denies every word a search may open", () => {
  for (const cmd of stillDenied) expect(bashTargetsDenylist(cmd, NO_DIR), cmd).toBe(true);
});

it("bashTargetsDenylist: passes a bare dir name handed to a command that dumps nothing", () => {
  for (const cmd of passes) expect(bashTargetsDenylist(cmd, NO_DIR), cmd).toBe(false);
});

it("bashTargetsDenylist: denies a dump of a denied path, bare, quoted, redirected, wrapped or nested", () => {
  for (const cmd of denies) expect(bashTargetsDenylist(cmd, NO_DIR), cmd).toBe(true);
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

function win(p: string) {
  return `C:\\r\\${p.replaceAll("/", "\\")}`;
}

function denied(r: GateResult) {
  return r?.type === "deny";
}

function claude(toolName: string, toolInput: ToolArgs) {
  return processFatTools(camelCall(toolName, toolInput));
}

function cursor(toolName: string, toolInput: ToolArgs) {
  return processFatTools({ cursor_version: "1", tool_input: toolInput, tool_name: toolName });
}

const shells: [string, Run][] = [
  ["claude", (command) => claude("Bash", { command })],
  ["codex", (command) => processFatTools({ model: "m", tool_input: { command }, tool_name: "bash", turn_id: "t" })],
  [
    "antigravity",
    (commandLine) => processFatTools({ toolCall: { args: { CommandLine: commandLine }, name: "RunCommand" } }),
  ],
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

function ignored(tool: string, input: ToolArgs) {
  return updatedInputOf(claude(tool, input));
}

it("stock references: injects an ignore list without the dependency dir for a search rooted in them", () => {
  const rest = GLOB_IGNORE.filter((s) => s !== nm);
  expect(ignored("Glob", { path: stockDir, pattern: "*" }).ignore).toStrictEqual(rest);
  expect(ignored("Glob", { pattern: "*", targetDirectory: stockDir }).ignoreGlobs).toStrictEqual(rest);
  expect(ignored("Glob", { path: "src", pattern: "*" }).ignore).toStrictEqual(GLOB_IGNORE);
  expect(JSON.stringify(ignored("Grep", { path: stockDir, pattern: "x" }))).not.toContain(`"${nm}"`);
});
