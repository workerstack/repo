import { BASE_CONFIG } from "../fixtures/base-config.ts";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { standards } from "../sync/standards.ts";
import { captureBun, captureTool, fmt, lint, runTool } from "./lint.ts";
import { childEnv } from "../env.ts";

/** A resolved config's agents with no host and no skill. */
const NO_AGENTS = { hosts: [], skills: [] };

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../bin/repo.ts");
const SLOW = 60_000;

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** A consumer root with `packs` in its config and `files` written under it. */
function repo(packs: string, files: Record<string, string> = {}): string {
  const root = tempDir("workerstack-lint-");
  const all = {
    "package.json": '{ "name": "app", "type": "module" }\n',
    "workerstack.config.ts": `export default { packs: ${packs} };\n`,
    ...files,
  };
  for (const [rel, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

/** A PATH holding bun alone, so a tool that needs node fails; it lives as long as the file's tests. */
const BUN_ONLY = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-bun-only-"));
fs.symlinkSync(process.execPath, path.join(BUN_ONLY, "bun"));
afterAll(() => fs.rmSync(BUN_ONLY, { recursive: true, force: true }));

const NON_NULL = 'export function a(names: string[]): string {\n  return names.find((name) => name !== "")!;\n}\n';
const FLOATING = "export function start(load: () => Promise<void>): void {\n  load();\n}\n";

/** A consumer with the standards pack, its two configs as sync writes them, and `files`. */
function standardsRepo(files: Record<string, string>): string {
  const ctx = {
    root: "",
    config: { packs: ["standards" as const], agents: NO_AGENTS, ...BASE_CONFIG },
    workspace: { root: "", manifest: {}, packages: [] },
    read: () => null,
  };
  const configs = Object.fromEntries(
    standards(ctx, []).outputs.map((output) => [output.path, output.kind === "file" ? output.content : ""]),
  );
  return repo('["standards"]', { ...configs, ...files });
}

describe("repo lint and repo fmt with the pinned tools, node off PATH", () => {
  const env = childEnv({ PATH: BUN_ONLY });
  const repoCmd = (root: string, ...args: string[]) => {
    const run = spawnSync(process.execPath, [BIN, ...args], { cwd: root, env, encoding: "utf8" });
    return { code: run.status, out: `${run.stdout}${run.stderr}` };
  };

  it("has no node to fall back on", () => {
    expect(spawnSync("node", ["--version"], { env }).error).toMatchObject({ code: "ENOENT" });
  });

  it("lint fails on a non-null assertion and, type-aware, on a floating promise", { timeout: SLOW }, () => {
    const root = repo('["standards"]', { "src/a.ts": `${NON_NULL}\n${FLOATING}` });
    expect(repoCmd(root, "sync").code).toBe(0);
    const lint = repoCmd(root, "lint");
    expect(lint.out).toContain("no-non-null-assertion");
    expect(lint.out).toContain("no-floating-promises");
    expect(lint.code).toBe(1);
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
      expect(repoCmd(root, "fmt", "--check")).toEqual({
        code: 0,
        out: expect.stringContaining("All matched files use the correct format"),
      });
      expect(repoCmd(root, "sync", "--check").code).toBe(0);
    },
  );
});

describe("the lint and fmt mains in process, with the real tools and node off PATH", () => {
  const saved = { cwd: process.cwd() };
  beforeEach(() => {
    vi.stubEnv("PATH", BUN_ONLY);
  });
  afterEach(() => {
    process.chdir(saved.cwd);
  });
  const lintIn = (root: string) => {
    process.chdir(root);
    return lint([]);
  };

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
      'repo fmt: the standards pack is off; add "standards" to packs in workerstack.config.ts\n',
    );
    write.mockRestore();
  });

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
  const capture = () => {
    const err: string[] = [];
    return { err, stderr: (s: string) => err.push(s) };
  };

  it.each([
    ["oxlint", "lint"],
    ["oxfmt", "fmt"],
  ] as const)("refuses %s while the standards pack is off, and runs nothing", async (tool, command) => {
    const root = repo('["docs"]');
    const run = vi.fn(() => 0);
    const io = capture();
    expect(await runTool(tool, [], { cwd: root, stderr: io.stderr, run })).toBe(1);
    expect(io.err.join("")).toBe(
      `repo ${command}: the standards pack is off; add "standards" to packs in workerstack.config.ts\n`,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the tool in the repo root with the arguments given, and returns its exit code", async () => {
    const root = repo('["standards"]', { ".oxlintrc.json": "{}\n", "src/x.ts": "" });
    const run = vi.fn(() => 3);
    const io = capture();
    expect(
      await runTool("oxlint", ["--format", "unix", "src"], { cwd: path.join(root, "src"), stderr: io.stderr, run }),
    ).toBe(3);
    expect(run).toHaveBeenCalledWith("oxlint", ["--format", "unix", "src"], root);
    expect(io.err).toEqual([]);
  });

  it("asks for repo sync when the tool's config is missing", async () => {
    const root = repo('["standards"]');
    const run = vi.fn(() => 0);
    const io = capture();
    expect(await runTool("oxfmt", ["--check"], { cwd: root, stderr: io.stderr, run })).toBe(1);
    expect(io.err.join("")).toBe("repo fmt: no .oxfmtrc.jsonc; run `bun repo sync` to write it\n");
    expect(run).not.toHaveBeenCalled();
  });

  it("reports a broken config and a missing one", async () => {
    const io = capture();
    expect(await runTool("oxlint", [], { cwd: repo('["lint"]'), stderr: io.stderr, run: () => 0 })).toBe(1);
    expect(io.err.join("")).toBe(
      'repo lint: workerstack.config.ts: packs[0]: "lint" is not a pack; use agents, standards, docs or release\n',
    );

    const bare = tempDir("workerstack-lint-bare-");
    const none = capture();
    expect(await runTool("oxfmt", [], { cwd: bare, stderr: none.stderr, run: () => 0 })).toBe(1);
    expect(none.err.join("")).toBe(
      `repo fmt: no workerstack.config.ts in ${bare} or any parent; run \`bun repo init\`\n`,
    );
  });
});

it("captureTool returns oxlint's json report and exit code instead of printing them", { timeout: SLOW }, () => {
  const root = standardsRepo({ "src/a.ts": NON_NULL, "src/ok.ts": "export const ok = 1;\n" });
  const failing = captureTool("oxlint", ["-f", "json", "src/a.ts"], root);
  const report = JSON.parse(failing.stdout) as { diagnostics: { filename: string; code: string }[] };
  expect([failing.code, report.diagnostics.map(({ filename, code }) => `${filename} ${code}`)]).toEqual([
    1,
    ["src/a.ts typescript(no-non-null-assertion)"],
  ]);
  expect(JSON.parse(captureTool("oxlint", ["-f", "json", "src/ok.ts"], root).stdout)).toMatchObject({
    diagnostics: [],
  });
});

it("captureBun keeps all of a run's output when it exits right after writing, and fails a killed run", () => {
  const script = 'process.stdout.write("x".repeat(4 * 1024 * 1024)); process.stderr.write("done"); process.exit(3);';
  const run = captureBun(["-e", script], os.tmpdir());
  expect([run.code, run.stdout.length, run.stderr]).toEqual([3, 4 * 1024 * 1024, "done"]);
  expect(captureBun(["-e", "process.kill(process.pid, 'SIGKILL')"], os.tmpdir()).code).toBe(1);
});
