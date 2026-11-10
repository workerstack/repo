import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { collectHistory, historyText } from "../../dev/stock-history.ts";
import { writeFloors } from "../coverage.ts";
import { BASE_CONFIG } from "../fixtures/base-config.ts";
import { standards } from "../sync/standards.ts";
import { cleanJsonDirs, jsonDir, keysOf, readText, SORTED, UNSORTED } from "./fixtures/json-dirs.ts";
import { cleanTemps, consumer, git, SLOW, staged, turn, write } from "./fixtures/turn-repo.ts";
import { fmt } from "./lint.ts";
import { sortedJsonText } from "./json-keys.ts";

afterEach(() => {
  cleanJsonDirs();
  cleanTemps();
});

/** A git repo with the standards pack, the two configs as sync writes them, and `files`. */
function formatRepo(files: Record<string, string>, repo = true): string {
  const ctx = {
    root: "",
    config: { packs: ["standards" as const], agents: { hosts: [], skills: [] }, ...BASE_CONFIG },
    workspace: { root: "", manifest: {}, packages: [] },
    read: () => null,
  };
  const configs = standards(ctx, []).outputs.flatMap((out): [string, string][] =>
    out.kind === "file" ? [[out.path, out.content]] : [],
  );
  const manifest = { "package.json": '{ "name": "app", "type": "module" }\n', "workerstack.config.ts": CONFIG };
  return jsonDir({ ...manifest, ...Object.fromEntries(configs), ...files }, repo);
}
const CONFIG = 'export default { packs: ["standards"] };\n';
const CLAUDE = "agents/settings/claude.json";
const io = () => {
  const err: string[] = [];
  return { err, stderr: (s: string) => err.push(s) };
};

it("fmt --check names the first key out of order and exits 1 whatever the tool says, and writes nothing", async () => {
  const root = formatRepo({ [CLAUDE]: UNSORTED });
  const run = vi.fn(() => 0);
  const out = io();
  expect(await fmt(["--check"], { cwd: root, stderr: out.stderr, run })).toBe(1);
  expect(out.err).toEqual([`repo fmt: ${CLAUDE} has keys out of order, first "hooks"; run \`bun repo fmt\`\n`]);
  expect(run).toHaveBeenCalledWith("oxfmt", ["--check"], root);
  expect(readText(root, CLAUDE)).toBe(UNSORTED);
});

it("fmt --check keeps the tool's own exit code when it fails, and is silent about a sorted tree", async () => {
  const root = formatRepo({ "a.json": SORTED });
  const out = io();
  expect(await fmt(["--check"], { cwd: root, stderr: out.stderr, run: () => 0 })).toBe(0);
  expect(await fmt(["--check"], { cwd: root, stderr: out.stderr, run: () => 2 })).toBe(2);
  expect(out.err).toEqual([]);
});

it("fmt sorts the files and runs the tool; a path argument narrows the sort, from the working directory", async () => {
  const root = formatRepo({ "a.json": UNSORTED, "dir/b.json": UNSORTED, "dir/c.json": UNSORTED });
  const run = vi.fn(() => 0);
  expect(await fmt(["b.json"], { cwd: path.join(root, "dir"), stderr: () => undefined, run })).toBe(0);
  expect([readText(root, "dir/b.json"), readText(root, "dir/c.json"), readText(root, "a.json")]).toEqual([
    SORTED,
    UNSORTED,
    UNSORTED,
  ]);
  expect(run).toHaveBeenCalledWith("oxfmt", ["b.json"], root);
  expect(await fmt([], { cwd: root, stderr: () => undefined, run })).toBe(0);
  expect([readText(root, "a.json"), readText(root, "dir/c.json")]).toEqual([SORTED, SORTED]);
});

it("fmt in a root with no git skips the key sort and runs the tool as before", async () => {
  const root = formatRepo({ "a.json": UNSORTED }, false);
  const run = vi.fn(() => 3);
  const out = io();
  expect(await fmt(["--check"], { cwd: root, stderr: out.stderr, run })).toBe(3);
  expect(out.err).toEqual([]);
  expect(run).toHaveBeenCalledWith("oxfmt", ["--check"], root);
  expect(readText(root, "a.json")).toBe(UNSORTED);
});

it("fmt refuses, running nothing, when the oxfmt config is not a config", async () => {
  const root = formatRepo({ ".oxfmtrc.jsonc": "[]\n" });
  const run = vi.fn(() => 0);
  const out = io();
  expect(await fmt([], { cwd: root, stderr: out.stderr, run })).toBe(1);
  expect(out.err.join("")).toMatch(/^repo fmt: .oxfmtrc.jsonc is not a valid oxfmt config/);
  expect(run).not.toHaveBeenCalled();
});

it(
  "fmt with the real tool sorts and formats, then --check passes and a second fmt changes no byte",
  { timeout: SLOW },
  async () => {
    const root = formatRepo({ "data.json": UNSORTED });
    const out = io();
    expect(await fmt([], { cwd: root, stderr: out.stderr })).toBe(0);
    expect(readText(root, "data.json")).toBe(SORTED);
    const state = () => spawnSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" }).stdout;
    const snapshot = [state(), readText(root, "data.json"), readText(root, "package.json")];
    expect(await fmt(["--check"], { cwd: root, stderr: out.stderr })).toBe(0);
    expect(await fmt([], { cwd: root, stderr: out.stderr })).toBe(0);
    expect([state(), readText(root, "data.json"), readText(root, "package.json")]).toEqual(snapshot);
    expect(out.err).toEqual([]);
  },
);

it(
  "turn counts a sorted json file as fixed, restages it, and leaves a staged sync output unsorted",
  { timeout: SLOW },
  async () => {
    const root = consumer({ "data.json": '{\n  "old": true\n}\n' });
    const generated = '{"rules":{},"categories":{}}\n';
    write(root, { "data.json": UNSORTED, ".oxlintrc.json": generated });
    git(root, "add", "-f", "data.json", ".oxlintrc.json");
    const result = await turn(root, ["--staged"]);
    expect(result.out).toMatch(/^turn: 2 files · fmt 1 fixed · /);
    expect(staged(root)).toEqual([".oxlintrc.json", "data.json"]);
    expect(git(root, "show", ":data.json")).toBe(SORTED);
    expect(git(root, "show", ":.oxlintrc.json")).toBe(generated);
  },
);

it("turn fails the fmt step when the oxfmt config is missing", { timeout: SLOW }, async () => {
  const root = consumer({ "data.json": SORTED });
  fs.rmSync(path.join(root, ".oxfmtrc.jsonc"));
  write(root, { "data.json": UNSORTED });
  const result = await turn(root, []);
  expect(result.out).toContain("fmt failed");
  expect(result.err).toContain(".oxfmtrc.jsonc is missing; run `bun repo sync` to write it");
  expect(result.code).toBe(1);
});

it("writeFloors writes paths and metrics in code-unit order, deep", () => {
  const root = jsonDir({}, false);
  const floor = { statements: 1, branches: 2, functions: 3, lines: 4 };
  expect(writeFloors(root, "floors.json", { "a.ts": floor, "B.ts": floor, "_x.ts": floor })).toBe(true);
  expect(keysOf(readText(root, "floors.json"))).toEqual(["B.ts", "_x.ts", "a.ts"]);
  expect(sortedJsonText(readText(root, "floors.json"))).toBeNull();
});

it("the stock history is written in code-unit order, deep", () => {
  const stock = { "agents/hooks.jsonc": "b\n", "AGENTS.md": "a\n", ".agents/skills/ask/SKILL.md": "x\n" };
  const root = jsonDir(stock);
  spawnSync("git", ["add", "-A"], { cwd: root });
  spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--no-verify", "-m", "i"], {
    cwd: root,
  });
  const text = historyText(collectHistory(root, ["HEAD"]));
  expect(keysOf(text)).toEqual([".agents/skills/ask/SKILL.md", "AGENTS.md", "agents/hooks.jsonc"]);
  expect(sortedJsonText(text)).toBeNull();
});
