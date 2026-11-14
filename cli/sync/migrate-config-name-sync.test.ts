import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { fixture, read, snapshot, sync, useSyncKit, write } from "../__fixtures__/sync-kit.ts";
import { CONFIG_FILE } from "../config.constants.ts";
import { main as coverageMain } from "../coverage.ts";
import { childEnv } from "../env.ts";
import { init } from "../init.ts";
import { realDeps } from "../mutate-real-deps.ts";
import { mergeMain } from "../scripts/ci-merge.ts";
import { timesMain } from "../scripts/ci-times.ts";
import { main as ciMain } from "../scripts/ci.ts";
import { runTool } from "../scripts/lint.ts";
import { main as turnMain } from "../scripts/turn.ts";

useSyncKit();

const OLD = "workerstack.config.ts";
const HINT = "workerstack.config.ts is now repo.config.ts; run bun repo sync";
const SLOW = 60_000;
const MOVED = "repo sync: moved workerstack.config.ts to repo.config.ts";

/** A synced-before consumer: the sync fixture with its config under the old name, a doc naming it, in git. */
function oldConsumer(): string {
  const root = fixture('export default { packs: ["agents", "docs"], agents: { hosts: ["claude"] } };\n');
  fs.renameSync(path.join(root, CONFIG_FILE), path.join(root, OLD));
  write(root, "docs/setup.md", "Configure workerstack.config.ts with WorkerstackConfig.\n");
  write(root, "packages/api/src/index.ts", 'import type { WorkerstackConfig } from "@workerstack/repo";\n');
  execFileSync("git", ["init", "-q"], { cwd: root, env: childEnv() });

  return root;
}

/** A tool a refused command must never reach. */
function never(): never {
  throw new Error("ran a tool");
}

it(
  "sync moves an old consumer's config before it looks for the root, and a rerun prints no move",
  async () => {
    const root = oldConsumer();
    const first = await sync(root);
    expect(first.stderr).toBe("");
    expect(first.code).toBe(0);
    expect(first.stdout.split("\n").slice(0, 2)).toStrictEqual([
      "repo sync: rewrote WorkerstackConfig and workerstack.config.ts in 2 files",
      MOVED,
    ]);
    expect(read(root, "docs/setup.md")).toBe("Configure repo.config.ts with RepoConfig.\n");
    expect(fs.existsSync(path.join(root, OLD))).toBe(false);
    const again = await sync(root);
    expect(again.code).toBe(0);
    expect(again.stdout).not.toMatch(/rewrote|moved workerstack/);
  },
  SLOW,
);

it("sync leaves the rewrote line out when no file names the old names", async () => {
  const root = fixture('export default { packs: ["agents", "docs"], agents: { hosts: ["claude"] } };\n');
  fs.renameSync(path.join(root, CONFIG_FILE), path.join(root, OLD));
  const first = await sync(root);
  expect(first.code).toBe(0);
  expect(first.stdout.split("\n")[0]).toBe(MOVED);
  expect(first.stdout).not.toContain("rewrote");
});

it("sync --check and a sync beside both files refuse", async () => {
  const root = oldConsumer();
  expect(await sync(root, "--check")).toStrictEqual({ code: 1, stderr: `repo sync: ${HINT}\n`, stdout: "" });
  write(root, CONFIG_FILE, "export default {};\n");
  expect(await sync(root)).toStrictEqual({
    code: 1,
    stderr: "repo sync: both workerstack.config.ts and repo.config.ts exist; delete one\nrepo sync: nothing written\n",
    stdout: "",
  });
  expect(read(root, "docs/setup.md")).toContain(OLD);
});

it("every root lookup names the move, and init refuses", async () => {
  const root = oldConsumer();
  const cwd = path.join(root, "packages", "api");
  const err: string[] = [];
  const io = { cwd, stderr: (s: string) => err.push(s), stdout: never };
  expect(await turnMain([], { cwd, stderr: io.stderr })).toBe(1);
  expect(await ciMain([], { cwd, stderr: io.stderr })).toBe(1);
  expect(mergeMain("blobs", { ...io, bins: { tsc: never, vitest: never } })).toBe(1);
  expect(timesMain("reports", io)).toBe(1);
  expect(await runTool("bun fmt", [], { cwd, run: never, stderr: io.stderr })).toBe(1);
  expect(await realDeps(cwd).config(cwd)).toStrictEqual([HINT]);
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
  vi.spyOn(process.stderr, "write").mockImplementation((s) => err.push(String(s)) > 0);
  expect(await coverageMain([])).toBe(1);
  expect(err).toStrictEqual(
    ["turn", "ci", "ci merge", "ci times", "fmt", "coverage"].map((name) => `repo ${name}: ${HINT}\n`),
  );
  expect(() => init(root, { execFileSync: never, skipGlobals: true })).toThrow(HINT);
  expect(fs.existsSync(path.join(root, CONFIG_FILE))).toBe(false);
});

const OLD_KEY = 'export default { packs: ["agents"], agents: { defaultMode: "away" } };\n';
const NEW_KEY = 'export default { packs: ["agents"], agents: { defaultApproval: "away" } };\n';
const KEY_RENAMED = "repo sync: renamed agents.defaultMode to agents.defaultApproval in repo.config.ts\n";
const KEY_HINT = "repo.config.ts: agents.defaultMode is now agents.defaultApproval; run bun repo sync";

it("sync rewrites defaultMode to defaultApproval before it loads the config, and a rerun prints nothing", async () => {
  const root = fixture(OLD_KEY);
  const first = await sync(root);

  expect([first.code, first.stderr]).toStrictEqual([0, ""]);
  expect(`${first.stdout.split("\n")[0]}\n`).toBe(KEY_RENAMED);
  expect(read(root, CONFIG_FILE)).toBe(NEW_KEY);
  const again = await sync(root);

  expect(again.code).toBe(0);
  expect(again.stdout).not.toContain("renamed agents.defaultMode");
});

it("sync --check names the rename, exits 1 and changes nothing", async () => {
  const root = fixture(OLD_KEY);
  const before = snapshot(root);

  expect(await sync(root, "--check")).toStrictEqual({ code: 1, stderr: `repo sync: ${KEY_HINT}\n`, stdout: "" });
  expect(snapshot(root)).toStrictEqual(before);
});

it("sync of an old-named config holding defaultMode moves it and renames the key, both lines printed", async () => {
  const root = fixture('export default { packs: ["agents"], agents: { defaultMode: "away" } };\n');
  fs.renameSync(path.join(root, CONFIG_FILE), path.join(root, OLD));
  const run = await sync(root);

  expect([run.code, run.stderr]).toStrictEqual([0, ""]);
  expect(run.stdout.split("\n").slice(0, 2)).toStrictEqual([MOVED, KEY_RENAMED.trimEnd()]);
  expect(read(root, CONFIG_FILE)).toBe(NEW_KEY);
});
