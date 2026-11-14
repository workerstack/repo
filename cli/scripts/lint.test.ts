import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { standardsFiles } from "../__fixtures__/standards-files.ts";
import { useTempTree } from "../__fixtures__/temp-tree.ts";
import { childEnv } from "../env.ts";
import { removeTree } from "../remove-tree.ts";
import { captureTool, fmt, lint, runTool, type RunTool } from "./lint.ts";

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../bin/repo.ts");
const SLOW = 60_000;

const tree = useTempTree("workerstack-lint-");

/** A consumer root with `packs` in its config and `files` written under it. */
function repo(packs: string, files: Record<string, string> = {}): string {
  return tree({
    "package.json": '{ "name": "app", "type": "module" }\n',
    "repo.config.ts": `export default { packs: ${packs} };\n`,
    ...files,
  });
}

/** A PATH holding bun alone, so a tool that needs node fails; it lives as long as the file's tests. */
const BUN_ONLY = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-bun-only-"));

fs.symlinkSync(process.execPath, path.join(BUN_ONLY, "bun"));

afterAll(() => removeTree(BUN_ONLY));

const NON_NULL = 'export function a(names: string[]): string {\n  return names.find((name) => name !== "")!;\n}\n';
const FLOATING = "export function start(load: () => Promise<void>): void {\n  load();\n}\n";

/** A consumer with the standards pack, its two configs as sync writes them, and `files`. */
function standardsRepo(files: Record<string, string>): string {
  return repo('["standards"]', { ...standardsFiles(), ...files });
}

/** The env of a spawned repo command: bun alone on PATH. */
const env = childEnv({ PATH: BUN_ONLY });

/** Runs `bun repo <args>` in `root` with bun alone on PATH; its exit code and its stdout then stderr. */
function repoCmd(root: string, ...args: string[]) {
  const run = spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: "utf8", env });

  return { code: run.status, out: `${run.stdout}${run.stderr}` };
}

/** Puts bun alone on PATH before each test of the calling block, and returns to the starting cwd after each. */
function useBunOnlyPath(): void {
  const saved = { cwd: process.cwd() };
  beforeEach(() => {
    vi.stubEnv("PATH", BUN_ONLY);
  });
  afterEach(() => process.chdir(saved.cwd));
}

/** Runs the lint main in `root`. */
function lintIn(root: string) {
  process.chdir(root);

  return lint([]);
}

/** A stderr that keeps what is written to it. */
function capture() {
  const err: string[] = [];

  return { err, stderr: (s: string) => err.push(s) };
}

describe("repo lint and repo fmt with the pinned tools, node off PATH", () => {
  it("has no node to fall back on", () => {
    expect(spawnSync("node", ["--version"], { env }).error).toMatchObject({ code: "ENOENT" });
  });

  it("lint fails on a non-null assertion and, type-aware, on a floating promise", { timeout: SLOW }, () => {
    const root = repo('["standards"]', { "src/a.ts": `${NON_NULL}\n${FLOATING}` });
    expect(repoCmd(root, "sync").code).toBe(0);
    const linted = repoCmd(root, "lint");
    expect(linted.out).toContain("no-non-null-assertion");
    expect(linted.out).toContain("no-floating-promises");
    expect(linted.code).toBe(1);
  });

  it(
    "fmt --check fails on an unformatted file, fmt fixes it, and leaves sync's files as sync wrote them",
    { timeout: SLOW },
    () => {
      const root = repo('["standards"]', { "src/b.ts": "export const a = {b:1}\n" });
      expect(repoCmd(root, "sync").code).toBe(0);
      const before = repoCmd(root, "fmt", "--check");
      expect(before.out).toContain("src/b.ts");
      expect(before.code).toBe(1);
      expect(repoCmd(root, "fmt").code).toBe(0);
      expect(fs.readFileSync(path.join(root, "src/b.ts"), "utf8")).toBe("export const a = { b: 1 };\n");
      const formatted: unknown = expect.stringContaining("All matched files use the correct format");
      expect(repoCmd(root, "fmt", "--check")).toStrictEqual({ code: 0, out: formatted });
      expect(repoCmd(root, "sync", "--check").code).toBe(0);
    },
  );
});

describe("the lint and fmt mains in process, with the real tools and node off PATH", () => {
  useBunOnlyPath();

  it(
    "lint exits 1 on a non-null assertion alone and, type-aware, on a floating promise alone, and 0 on clean code",
    { timeout: SLOW },
    async () => {
      expect(await lintIn(standardsRepo({ "src/a.ts": NON_NULL }))).toBe(1);
      expect(await lintIn(standardsRepo({ "src/start.ts": FLOATING }))).toBe(1);
      expect(await lintIn(standardsRepo({ "src/a.ts": "export const a = 1;\n" }))).toBe(0);
    },
  );

  it("prints a refusal to stderr", async () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    process.chdir(repo("[]"));
    expect(await fmt([])).toBe(1);
    expect(write).toHaveBeenCalledWith(
      'repo fmt: the standards pack is off; add "standards" to packs in repo.config.ts\n',
    );
    write.mockRestore();
  });
});

describe("the lint and fmt mains in process, with the real tools and node off PATH", () => {
  useBunOnlyPath();

  it(
    "fmt --check exits 1 on an unformatted file, fmt rewrites it, and the check then exits 0",
    { timeout: SLOW },
    async () => {
      const root = standardsRepo({ "src/b.ts": "export const a = {b:1}\n" });
      process.chdir(root);
      expect(await fmt(["--check"])).toBe(1);
      expect(await fmt([])).toBe(0);
      expect(fs.readFileSync(path.join(root, "src/b.ts"), "utf8")).toBe("export const a = { b: 1 };\n");
      expect(await fmt(["--check"])).toBe(0);
    },
  );
});

describe("runTool", () => {
  it.each([
    ["oxlint", "lint"],
    ["bun fmt", "fmt"],
  ] as const)("refuses %s while the standards pack is off, and runs nothing", async (tool, command) => {
    const root = repo('["docs"]');
    const run = vi.fn<RunTool>(() => 0);
    const io = capture();
    expect(await runTool(tool, [], { cwd: root, run, stderr: io.stderr })).toBe(1);
    expect(io.err.join("")).toBe(
      `repo ${command}: the standards pack is off; add "standards" to packs in repo.config.ts\n`,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the tool in the repo root with the arguments given, and returns its exit code", async () => {
    const root = repo('["standards"]', { ".oxlintrc.jsonc": "{}\n", "src/x.ts": "" });
    const run = vi.fn<RunTool>(() => 3);
    const io = capture();
    expect(
      await runTool("oxlint", ["--format", "unix", "src"], { cwd: path.join(root, "src"), run, stderr: io.stderr }),
    ).toBe(3);
    expect(run).toHaveBeenCalledWith("oxlint", ["--format", "unix", "src"], root);
    expect(io.err).toStrictEqual([]);
  });
});

describe("runTool", () => {
  it("asks for repo sync when the tool's config is missing", async () => {
    const root = repo('["standards"]');
    const run = vi.fn<RunTool>(() => 0);
    const io = capture();
    expect(await runTool("bun fmt", ["--check"], { cwd: root, run, stderr: io.stderr })).toBe(1);
    expect(io.err.join("")).toBe("repo fmt: no .oxfmtrc.jsonc; run `bun repo sync` to write it\n");
    expect(run).not.toHaveBeenCalled();
  });

  it("asks for repo sync when the oxlint config is missing", async () => {
    const root = repo('["standards"]');
    const io = capture();
    expect(await runTool("oxlint", [], { cwd: root, run: () => 0, stderr: io.stderr })).toBe(1);
    expect(io.err.join("")).toBe("repo lint: no .oxlintrc.jsonc; run `bun repo sync` to write it\n");
  });

  it("reports a broken config and a missing one", async () => {
    const io = capture();
    expect(await runTool("oxlint", [], { cwd: repo('["lint"]'), run: () => 0, stderr: io.stderr })).toBe(1);
    expect(io.err.join("")).toBe(
      'repo lint: repo.config.ts: packs[0]: "lint" is not a pack; ' +
        "use agents, standards, docs, release, workspace, benchmark or evals\n",
    );

    const bare = tree({});
    const none = capture();
    expect(await runTool("bun fmt", [], { cwd: bare, run: () => 0, stderr: none.stderr })).toBe(1);
    expect(none.err.join("")).toBe(`repo fmt: no repo.config.ts in ${bare} or any parent; run \`bun repo init\`\n`);
  });
});

it("captureTool returns oxlint's json report and exit code instead of printing them", { timeout: SLOW }, () => {
  const root = standardsRepo({ "src/a.ts": NON_NULL, "src/ok.ts": "export const ok = 1;\n" });
  const failing = captureTool("oxlint", ["-f", "json", "src/a.ts"], root);

  const report = JSON.parse(failing.stdout) /* oxlint -f json prints one report object */ as {
    diagnostics: { filename: string; code: string }[];
  };

  expect([failing.code, report.diagnostics.map(({ filename, code }) => `${filename} ${code}`)]).toStrictEqual([
    1,
    ["src/a.ts typescript(no-non-null-assertion)"],
  ]);
  expect(JSON.parse(captureTool("oxlint", ["-f", "json", "src/ok.ts"], root).stdout)).toMatchObject({
    diagnostics: [],
  });
});
