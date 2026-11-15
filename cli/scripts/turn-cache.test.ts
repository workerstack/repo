import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { plantProgram } from "../__fixtures__/stub-bin.ts";
import { childEnv } from "../env.ts";
import { edited, labels, rerun, turnCalls } from "./__fixtures__/turn-cache-kit.ts";
import { cleanTemps, git, precommit, recording, SLOW, tempDir, turn, write } from "./__fixtures__/turn-repo.ts";
import type { Bins } from "./turn-steps.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  cleanTemps();
});

const DEPENDENCIES = `node_modules`;

/** A dependency installed by hand in a consumer with no linked install. */
const FAKE_DEP = path.join(DEPENDENCIES, "fakedep");

function fakeManifest(version: string): string {
  return `${JSON.stringify({ name: "fakedep", version })}\n`;
}

const TSC_FAILS: Bins = {
  tsc: () => Promise.resolve({ code: 1, stderr: "", stdout: "a.ts: bad\n" }),
  vitest: () => null,
};

it("a second turn on the same tree runs no step and counts the cached ones", { timeout: SLOW }, async () => {
  const root = edited();
  const first = await turnCalls(root);
  expect(first.result.code, first.result.err).toBe(0);
  expect(first.calls).not.toStrictEqual([]);
  const second = await turnCalls(root);
  expect(second.calls).toStrictEqual([]);
  expect(second.result).toStrictEqual({
    code: 0,
    err: "",
    out: `turn: 1 file · ${labels(first.result.out).length} cached\n`,
  });
});

it("precommit after a passing turn with everything staged runs only the tests step", { timeout: SLOW }, async () => {
  const root = edited();
  const first = await turnCalls(root);
  expect(first.result.code, first.result.err).toBe(0);
  git(root, "add", "-A");
  const rec = recording(root);
  const result = await precommit(root, rec.bins);
  expect(rec.calls.map((call) => call.split(" ")[0])).toStrictEqual(["vitest"]);
  expect(labels(result.out).at(-1)).toBe(`${labels(first.result.out).length} cached`);
  expect(result.code).toBe(0);
});

it("precommit with a changed file left unstaged reruns every step", { timeout: SLOW }, async () => {
  const root = edited({ "src/b.ts": "export const b = 1;\n" });
  write(root, { "src/b.ts": "export const b = 2;\n" });
  const first = await turnCalls(root);
  expect(first.result.code, first.result.err).toBe(0);
  git(root, "add", "src/a.ts");
  const rec = recording(root);
  const result = await precommit(root, rec.bins);
  expect(rec.calls.map((call) => call.split(" ")[0])).toContain("tsc");
  expect(result.out).not.toMatch(/cached/);
});

it("an edit after a cached pass reruns every step", { timeout: SLOW }, async () => {
  const root = edited();
  const calls = await rerun(root, () => write(root, { "src/a.ts": "export const a = 3;\n" }));
  expect(calls).not.toStrictEqual([]);
});

it("a new commit with the same tree reruns every step", { timeout: SLOW }, async () => {
  const root = edited();
  const calls = await rerun(root, () => git(root, "commit", "-q", "--no-verify", "--allow-empty", "-m", "empty"));
  expect(calls).not.toStrictEqual([]);
});

it("a changed ignored .env or generated lint config reruns every step", { timeout: SLOW }, async () => {
  const root = edited();
  write(root, { ".env": "A=1\n" });
  git(root, "check-ignore", "-q", ".env");
  expect(await rerun(root, () => write(root, { ".env": "A=2\n" }))).not.toStrictEqual([]);
  const config = fs.readFileSync(path.join(root, ".oxlintrc.jsonc"), "utf8");
  expect(await rerun(root, () => write(root, { ".oxlintrc.jsonc": `${config}\n` }))).not.toStrictEqual([]);
});

it("a backlog edit keeps the cached pass", { timeout: SLOW }, async () => {
  const root = edited();
  expect(await rerun(root, () => write(root, { ".repo/backlog.md": "- [ ] later\n" }))).toStrictEqual([]);
});

it("a dependency's new version or link marker reruns every step", { timeout: SLOW }, async () => {
  const manifest = `${JSON.stringify({ dependencies: { fakedep: "1.0.0" }, name: "app", type: "module" })}\n`;
  const root = edited({ "package.json": manifest }, { deps: false });
  write(root, { [path.join(FAKE_DEP, "package.json")]: fakeManifest("1.0.0") });

  function bumped() {
    write(root, { [path.join(FAKE_DEP, "package.json")]: fakeManifest("1.0.1") });
  }

  function linked() {
    write(root, { [path.join(FAKE_DEP, ".repo-link")]: '{"name":"fakedep","source":"/x"}\n' });
  }

  expect(await rerun(root, bumped)).not.toStrictEqual([]);
  expect(await rerun(root, linked)).not.toStrictEqual([]);
});

it("a failed gate records nothing", { timeout: SLOW }, async () => {
  const root = edited();
  const failed = await turn(root, [], TSC_FAILS);
  expect(failed.code).toBe(1);
  const next = await turnCalls(root);
  expect(next.calls).not.toStrictEqual([]);
});

it("a gate leaves no temp index behind", { timeout: SLOW }, async () => {
  const root = edited();
  const tmp = tempDir("workerstack-turn-tmp-");
  vi.stubEnv("TMPDIR", tmp);
  const passing = await turnCalls(root);
  expect(passing.result.code).toBe(0);
  const cachedRun = await turn(root, [], TSC_FAILS);
  expect(cachedRun.code).toBe(0);
  write(root, { "src/a.ts": "export const a = 4;\n" });
  const failed = await turn(root, [], TSC_FAILS);
  expect(failed.code).toBe(1);
  expect(fs.readdirSync(tmp)).toStrictEqual([]);
});

it("node joining the PATH, then a new node version, each rerun every step", { timeout: SLOW }, async () => {
  const root = edited();
  const bin = tempDir("workerstack-turn-bin-");
  const tools = ["git", "bun"].map((tool) => Bun.which(tool) ?? tool);

  // A link to git.exe does not start on win32, so PATH takes the real dirs there: Git's cmd dir and bun's hold no node.
  const isWindows = process.platform === "win32";

  for (const tool of isWindows ? [] : tools) fs.symlinkSync(tool, path.join(bin, path.basename(tool)));
  const dirs = isWindows ? tools.map((tool) => path.dirname(tool)) : [];
  vi.stubEnv("PATH", [bin, ...dirs].join(path.delimiter));
  expect(Bun.which("node", { PATH: childEnv()["PATH"] ?? "" })).toBeNull();

  /** Puts a `node` on the PATH that prints `version`: the spawn has no shell, so on win32 it is a real node.exe. */
  function node(version: string): () => void {
    return () => {
      plantProgram(bin, "node", `console.log(${JSON.stringify(version)});\n`);
    };
  }

  expect(await rerun(root, node("v1.0.0"))).not.toStrictEqual([]);
  expect(await rerun(root, node("v1.0.1"))).not.toStrictEqual([]);
});
