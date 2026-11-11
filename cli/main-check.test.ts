import fs from "node:fs";
import path from "node:path";

import { expect, it, vi } from "vitest";

import type * as CommandsModule from "./commands.ts";
import type * as GithubApplyModule from "./github-apply.ts";
import type * as InitModule from "./init.ts";

const fakes = await vi.hoisted(async () => {
  const kit = await import("./fixtures/main-kit.ts");
  return kit.mainFakes();
});
vi.mock(new URL("./commands.ts", import.meta.url).href, async (importOriginal) => ({
  ...(await importOriginal<typeof CommandsModule>()),
  runCommand: fakes.runCommand,
}));
vi.mock(new URL("./init.ts", import.meta.url).href, async (importOriginal) => ({
  ...(await importOriginal<typeof InitModule>()),
  init: fakes.init,
}));
vi.mock(new URL("./github-apply.ts", import.meta.url).href, async (importOriginal) => {
  const actual = await importOriginal<typeof GithubApplyModule>();
  return { ...actual, checkGithubAt: (cwd: string) => actual.checkGithubAt(cwd, { ci: false, gh: fakes.githubIo.gh }) };
});
vi.mock(new URL("./sync.ts", import.meta.url).href, () => ({ runSync: fakes.runSync }));
vi.mock(new URL("./scripts/folder-map.ts", import.meta.url).href, () => ({ mapCommand: fakes.mapCommand }));
vi.mock(new URL("./prompt.ts", import.meta.url).href, () => fakes);
import { latestFetch, useCheckRepo, usePacks, writeConfigs } from "./fixtures/check-repo.ts";
import { pkgVersion, useStart } from "./fixtures/main-kit.ts";
import { start } from "./main.ts";

const written = useStart(fakes);
const repo = useCheckRepo(fakes, written);
const { runSync } = fakes;

const SETS_FILES = (rel: string) =>
  `repo check: tsconfig: ${rel} sets "files", which replaces the base's reset.d.ts. List sources under "include".`;
const NO_BASE = (rel: string) =>
  `repo check: tsconfig: ${rel} does not extend a base. \
Extend "@workerstack/repo/tsconfig/base", "bun", "worker" or "web".`;
const NO_SRC = (dir: string) =>
  `repo check: tsconfig: ${dir} has no tsconfig.src.json; \
add one with "extends": ["./tsconfig.json", "@workerstack/repo/tsconfig/strict"] \
and an "exclude" that repeats tsconfig.json's and adds the tests`;

it("fails when the installed package is behind npm's latest", async () => {
  writeConfigs(repo);
  vi.stubGlobal("fetch", latestFetch("999.0.0"));
  await start();
  expect(written.err.join("")).toContain(`repo check: @workerstack/repo ${pkgVersion()} is behind 999.0.0 on npm;`);
  expect(process.exitCode).toBe(1);
});

it("reports a skipped version check on stdout without failing", async () => {
  writeConfigs(repo);
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
  await start();
  expect(written.out.join("")).toContain("repo check: could not ask npm for the latest @workerstack/repo (offline)");
});

it("holds a workspace to the workspace pack only when the pack is on", async () => {
  writeConfigs(repo);
  repo.write("package.json", { dependencies: { lodash: "1.0.0" }, private: true, workspaces: ["packages/*"] });
  usePacks(repo, "standards");
  await start();
  expect(repo.besidesKnip()).not.toContain("a workspace root has no");
  usePacks(repo, "workspace");
  process.exitCode = 0;
  await start();
  expect(repo.besidesKnip()).toContain(
    'repo check: package.json: a workspace root has no "dependencies"; move "lodash" into the package that uses it\n',
  );
  expect(process.exitCode).toBe(1);
});

it("reports an untracked Cargo.lock of a Rust repo", { timeout: 300_000 }, async () => {
  writeConfigs(repo);
  fs.cpSync(path.join(import.meta.dirname, "rust", "fixtures", "lib-crate"), repo.dir(), { recursive: true });
  await start();
  expect(written.err.join("")).toContain(
    "repo check: Cargo.lock is not tracked; commit it (cargo runs with --locked)\n",
  );
  expect(process.exitCode).toBe(1);
});

it("prints every bad tsconfig, still runs repo sync --check and exits 1", async () => {
  repo.write("a/tsconfig.json", { extends: "@workerstack/repo/tsconfig/bun", files: ["src/a.ts"] });
  repo.write("b/tsconfig.json", { include: ["src"] });
  await start();
  expect(repo.besidesKnip()).toBe(
    [SETS_FILES("a/tsconfig.json"), NO_SRC("a"), NO_BASE("b/tsconfig.json"), NO_SRC("b"), ""].join("\n"),
  );
  expect(runSync).toHaveBeenCalledOnce();
  expect(runSync).toHaveBeenCalledWith(["--check"], expect.objectContaining({ cwd: repo.dir() }));
  expect(process.exitCode).toBe(1);
});

it("prints each CHANGELOG.md problem of a public root and exits 1", async () => {
  writeConfigs(repo);
  repo.write("package.json", {});
  repo.put("CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n\n### Improved\n");
  await start();
  expect(repo.besidesKnip()).toContain(
    `repo check: CHANGELOG.md:5: "### Improved" is not a section; \
use Added, Changed, Deprecated, Removed, Fixed or Security\n`,
  );
  expect(process.exitCode).toBe(1);
});

it("prints a second env.ts in one package and exits 1", async () => {
  writeConfigs(repo);
  repo.write("package.json", {});
  repo.put("env.ts", "export {};\n");
  repo.put("src/env.ts", "export {};\n");
  await start();
  expect(repo.besidesKnip()).toBe("repo check: env: env.ts and src/env.ts are both env.ts in .; keep one\n");
  expect(runSync).toHaveBeenCalledOnce();
  expect(process.exitCode).toBe(1);
});

it("leaves the exit code at 0 when every tsconfig keeps a base", async () => {
  writeConfigs(repo);
  await start();
  expect(repo.besidesKnip()).toBe("");
  expect(runSync).toHaveBeenCalledOnce();
  expect(runSync).toHaveBeenCalledWith(["--check"], expect.objectContaining({ cwd: repo.dir() }));
  expect(process.exitCode).toBe(0);
});

it("without the standards pack says nothing of disable comments", async () => {
  writeConfigs(repo);
  repo.put("src/a.ts", "export const a = 1;\n// @ts-ignore\n");
  await start();
  expect(repo.besidesKnip()).toBe("");
  expect(process.exitCode).toBe(0);
});

it("without the standards pack prints no manifest lines", async () => {
  writeConfigs(repo);
  repo.write("package.json", { name: "app" });
  await start();
  expect(repo.besidesKnip()).toBe("");
  expect(process.exitCode).toBe(0);
});

it("leaves an unreadable manifest to sync --check and prints nothing twice", { timeout: 60_000 }, async () => {
  writeConfigs(repo);
  repo.write("package.json", { name: "app", private: "yes" });
  usePacks(repo, "standards");
  runSync.mockResolvedValue(1);
  await start();
  expect(repo.besidesKnip()).not.toContain("repo check: package.json");
  expect(process.exitCode).toBe(1);
});

it("exits 1 when sync --check finds drift", async () => {
  writeConfigs(repo);
  runSync.mockResolvedValue(1);
  await start();
  expect(process.exitCode).toBe(1);
});
