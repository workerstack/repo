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
import { fmt, type RunTool } from "./lint.ts";
import { sortedJsonText } from "./sorted-json-text.ts";

afterEach(() => {
  cleanJsonDirs();
  cleanTemps();
});

/** A git repo with the standards pack, the two configs as sync writes them, and `files`. */
function formatRepo(files: Record<string, string>, { repo = true }: { repo?: boolean } = {}): string {
  const ctx = {
    config: { agents: { hosts: [], skills: [] }, packs: ["standards" as const], ...BASE_CONFIG },
    read: () => null,
    root: "",
    workspace: { manifest: {}, packages: [], root: "" },
  };
  const configs = standards(ctx, []).outputs.flatMap((out): [string, string][] =>
    out.kind === "file" ? [[out.path, out.content]] : [],
  );
  const manifest = { "package.json": '{ "name": "app", "type": "module" }\n', "workerstack.config.ts": CONFIG };
  return jsonDir({ ...manifest, ...Object.fromEntries(configs), ...files }, repo);
}
const CONFIG = 'export default { packs: ["standards"] };\n';
const CLAUDE = "agents/settings/claude.json";
function io() {
  const err: string[] = [];
  return { err, stderr: (s: string) => err.push(s) };
}

it("fmt --check names the first key out of order and exits 1 whatever the tool says, and writes nothing", async () => {
  const root = formatRepo({ [CLAUDE]: UNSORTED });
  const run = vi.fn<RunTool>(() => 0);
  const out = io();
  expect(await fmt(["--check"], { cwd: root, run, stderr: out.stderr })).toBe(1);
  expect(out.err).toStrictEqual([`repo fmt: ${CLAUDE} has keys out of order, first "hooks"; run \`bun repo fmt\`\n`]);
  expect(run).toHaveBeenCalledWith("oxfmt", ["--check"], root);
  expect(readText(root, CLAUDE)).toBe(UNSORTED);
});

it("fmt --check names the first key of an unsorted jsonc and of a json with comments; fmt sorts both", async () => {
  const commented = '{\n  "b": 1, // why\n  "a": 2\n}\n';
  const root = formatRepo({ "conf/x.jsonc": commented, "ok.jsonc": SORTED, "tsconfig.json": commented });
  const out = io();
  expect(await fmt(["--check"], { cwd: root, run: () => 0, stderr: out.stderr })).toBe(1);
  expect(out.err).toStrictEqual([
    `repo fmt: conf/x.jsonc has keys out of order, first "a"; run \`bun repo fmt\`\n`,
    `repo fmt: tsconfig.json has keys out of order, first "a"; run \`bun repo fmt\`\n`,
  ]);
  expect(readText(root, "tsconfig.json")).toBe(commented);
  expect(await fmt([], { cwd: root, run: () => 0, stderr: out.stderr })).toBe(0);
  expect([readText(root, "conf/x.jsonc"), readText(root, "tsconfig.json")]).toStrictEqual([
    '{\n  "a": 2,\n  "b": 1 // why\n}\n',
    '{\n  "a": 2,\n  "b": 1 // why\n}\n',
  ]);
  expect(await fmt(["--check"], { cwd: root, run: () => 0, stderr: () => {} })).toBe(0);
});

it("fmt converts own-line block comments in the same listing, skips fixtures dirs, narrows to paths", async () => {
  const block = '{\n  /* base */\n  "extends": "x"\n}\n';
  const root = formatRepo({
    "a.jsonc": block,
    "dir/b.json": block,
    "dir/fixtures/d.json": block,
    "fixtures/c.jsonc": block,
  });
  const out = io();
  expect(await fmt(["--check", "dir"], { cwd: root, run: () => 0, stderr: out.stderr })).toBe(1);
  expect(out.err.join("")).toMatch(/dir\/b\.json has an own-line/);
  expect(out.err.join("")).not.toMatch(/a\.jsonc|fixtures/);
  expect(await fmt([], { cwd: root, run: () => 0, stderr: out.stderr })).toBe(0);
  const converted = '{\n  // base\n  "extends": "x"\n}\n';
  expect([readText(root, "a.jsonc"), readText(root, "dir/b.json")]).toStrictEqual([converted, converted]);
  expect([readText(root, "fixtures/c.jsonc"), readText(root, "dir/fixtures/d.json")]).toStrictEqual([block, block]);
});

it("fmt lists nothing outside a git repo, so no jsonc is converted or sorted", async () => {
  const root = formatRepo({ "a.jsonc": '{\n  /* x */\n  "b": 1, "a": 2\n}\n' }, { repo: false });
  expect(await fmt([], { cwd: root, run: () => 0, stderr: () => {} })).toBe(0);
  expect(readText(root, "a.jsonc")).toContain("/* x */");
});

it("fmt leaves a git-ignored and an oxfmt-ignored jsonc untouched", async () => {
  const commented = '{\n  "b": 1,\n  "a": 2\n}\n';
  const root = formatRepo({ ".gitignore": "git.jsonc\n", "fixtures/f.jsonc": commented, "git.jsonc": commented });
  expect(await fmt([], { cwd: root, run: () => 0, stderr: () => {} })).toBe(0);
  expect([readText(root, "git.jsonc"), readText(root, "fixtures/f.jsonc")]).toStrictEqual([commented, commented]);
});

it("fmt --check keeps the tool's own exit code when it fails, and is silent about a sorted tree", async () => {
  const root = formatRepo({ "a.json": SORTED });
  const out = io();
  expect(await fmt(["--check"], { cwd: root, run: () => 0, stderr: out.stderr })).toBe(0);
  expect(await fmt(["--check"], { cwd: root, run: () => 2, stderr: out.stderr })).toBe(2);
  expect(out.err).toStrictEqual([]);
});

it("fmt sorts the files and runs the tool; a path argument narrows the sort, from the working directory", async () => {
  const root = formatRepo({ "a.json": UNSORTED, "dir/b.json": UNSORTED, "dir/c.json": UNSORTED });
  const run = vi.fn<RunTool>(() => 0);
  expect(await fmt(["b.json"], { cwd: path.join(root, "dir"), run, stderr: () => {} })).toBe(0);
  expect([readText(root, "dir/b.json"), readText(root, "dir/c.json"), readText(root, "a.json")]).toStrictEqual([
    SORTED,
    UNSORTED,
    UNSORTED,
  ]);
  expect(run).toHaveBeenCalledWith("oxfmt", ["b.json"], root);
  expect(await fmt([], { cwd: root, run, stderr: () => {} })).toBe(0);
  expect([readText(root, "a.json"), readText(root, "dir/c.json")]).toStrictEqual([SORTED, SORTED]);
});

it("fmt in a root with no git skips the key sort and runs the tool as before", async () => {
  const root = formatRepo({ "a.json": UNSORTED }, { repo: false });
  const run = vi.fn<RunTool>(() => 3);
  const out = io();
  expect(await fmt(["--check"], { cwd: root, run, stderr: out.stderr })).toBe(3);
  expect(out.err).toStrictEqual([]);
  expect(run).toHaveBeenCalledWith("oxfmt", ["--check"], root);
  expect(readText(root, "a.json")).toBe(UNSORTED);
});

it("fmt refuses, running nothing, when the oxfmt config is not a config", async () => {
  const root = formatRepo({ ".oxfmtrc.jsonc": "[]\n" });
  const run = vi.fn<RunTool>(() => 0);
  const out = io();
  expect(await fmt([], { cwd: root, run, stderr: out.stderr })).toBe(1);
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
    function state() {
      return spawnSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" }).stdout;
    }
    const snapshot = [state(), readText(root, "data.json"), readText(root, "package.json")];
    expect(await fmt(["--check"], { cwd: root, stderr: out.stderr })).toBe(0);
    expect(await fmt([], { cwd: root, stderr: out.stderr })).toBe(0);
    expect([state(), readText(root, "data.json"), readText(root, "package.json")]).toStrictEqual(snapshot);
    expect(out.err).toStrictEqual([]);
  },
);

it(
  "turn counts a sorted json file as fixed, restages it, and leaves a staged sync output unsorted",
  { timeout: SLOW },
  async () => {
    const root = consumer({ "data.json": '{\n  "old": true\n}\n' });
    const generated = '{"rules":{},"categories":{}}\n';
    write(root, { ".oxlintrc.json": generated, "data.json": UNSORTED });
    git(root, "add", "-f", "data.json", ".oxlintrc.json");
    const result = await turn(root, ["--staged"]);
    expect(result.out).toMatch(/^turn: 2 files · fmt 1 fixed · /);
    expect(staged(root)).toStrictEqual([".oxlintrc.json", "data.json"]);
    expect(git(root, "show", ":data.json")).toBe(SORTED);
    expect(git(root, "show", ":.oxlintrc.json")).toBe(generated);
  },
);

it("turn sorts a jsonc it is given, comments moving with their key", { timeout: SLOW }, async () => {
  const root = consumer({ "a.jsonc": '{\n  "a": 1\n}\n' });
  write(root, { "a.jsonc": '{\n  "b": 1, // why\n  "a": 2\n}\n' });
  git(root, "add", "-f", "a.jsonc");
  const result = await turn(root, ["--staged"]);
  expect(result.out).toMatch(/fmt 1 fixed/);
  expect(git(root, "show", ":a.jsonc")).toBe('{\n  "a": 2,\n  "b": 1 // why\n}\n');
});

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
  const floor = { branches: 2, functions: 3, lines: 4, statements: 1 };
  expect(writeFloors(root, "floors.json", { "B.ts": floor, "_x.ts": floor, "a.ts": floor })).toBe(true);
  expect(keysOf(readText(root, "floors.json"))).toStrictEqual(["B.ts", "_x.ts", "a.ts"]);
  expect(sortedJsonText(readText(root, "floors.json"))).toBeNull();
});

it("the stock history is written in code-unit order, deep", () => {
  const stock = { ".agents/skills/ask/SKILL.md": "x\n", "AGENTS.md": "a\n", "agents/hooks.jsonc": "b\n" };
  const root = jsonDir(stock);
  spawnSync("git", ["add", "-A"], { cwd: root });
  spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--no-verify", "-m", "i"], {
    cwd: root,
  });
  const text = historyText(collectHistory(root, ["HEAD"]));
  expect(keysOf(text)).toStrictEqual([".agents/skills/ask/SKILL.md", "AGENTS.md", "agents/hooks.jsonc"]);
  expect(sortedJsonText(text)).toBeNull();
});
