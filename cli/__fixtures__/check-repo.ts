// A consumer repo for the `repo check` suites: git, a changelog, and this checkout linked where an install puts it.
import { execFileSync as runGit } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import { BASE_CONFIG } from "./base-config.ts";
import { pkgRoot, pkgVersion, type MainFakes, type Written } from "./main-kit.ts";
import { standards } from "../sync/standards.ts";

/** A fetch that answers every request with a registry document whose latest tag is `latest`. */
export const latestFetch = (latest: string) => (): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify({ versions: { [latest]: {} }, "dist-tags": { latest } })));

/** The repo a check test runs in, and what it writes there. */
export type CheckRepo = {
  dir: () => string;
  /** `content` as JSON at `rel`. */
  write: (rel: string, content: object) => void;
  /** `text` at `rel`, making its dirs. */
  put: (rel: string, text: string) => void;
  /** What check printed to stderr but knip's lines, which the tests of other checks do not pin. */
  besidesKnip: () => string;
};

/** A root tsconfig.json on the bun base and its strict tsconfig.src.json, which check passes. */
export function writeConfigs(repo: CheckRepo): void {
  repo.write("tsconfig.json", { extends: "@workerstack/repo/tsconfig/bun", include: ["src"] });
  repo.write("tsconfig.src.json", {
    extends: ["./tsconfig.json", "@workerstack/repo/tsconfig/strict"],
    exclude: ["node_modules", "**/*.test.ts"],
  });
}

/** A repo.config.ts that turns on `packs` and nothing else. */
export function usePacks(repo: CheckRepo, ...packs: string[]): void {
  repo.put("repo.config.ts", `export default { packs: ${JSON.stringify(packs)} };\n`);
}

/** A package.json `repo check` passes under the standards pack. */
export function writeCleanManifest(repo: CheckRepo): void {
  repo.write("package.json", { name: "app", private: true, sideEffects: false, packageManager: `bun@${Bun.version}` });
}

/** The files the standards pack's sync writes, the oxlint config among them. */
export function writeStandardsOutputs(repo: CheckRepo): void {
  const config = { packs: ["standards" as const], agents: { hosts: [], skills: [] }, ...BASE_CONFIG };
  const workspace = { root: "", manifest: {}, packages: [] };
  for (const output of standards({ root: "", config, workspace, read: () => null }, []).outputs)
    if (output.kind === "file") repo.put(output.path, output.content);
}

/** Commits the working tree to `main`, then moves to a `feature` branch. */
export function commitMain(repo: CheckRepo): void {
  const config = ["user.name=t", "user.email=t@t", "commit.gpgsign=false", "core.autocrlf=false"];
  const git = (...args: string[]) =>
    runGit("git", [...config.flatMap((pair) => ["-c", pair]), ...args], { cwd: repo.dir() });
  git("checkout", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "main");
  git("checkout", "-q", "-b", "feature");
}

/** Adds `url` as the repo's origin. */
export function addOrigin(repo: CheckRepo, url: string): void {
  runGit("git", ["remote", "add", "origin", url], { cwd: repo.dir() });
}

/** Before each test a fresh repo is cwd and argv is `repo check`; after it, the repo is removed. */
export function useCheckRepo(fakes: MainFakes, written: Written): CheckRepo {
  let dir = "";
  const repo: CheckRepo = {
    dir: () => dir,
    write: (rel, content) => repo.put(rel, `${JSON.stringify(content)}\n`),
    put: (rel, text) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    },
    besidesKnip: () => written.err.filter((line) => !line.startsWith("repo check: knip")).join(""),
  };
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-check-"));
    runGit("git", ["init", "-q"], { cwd: dir });
    // A public package must keep a changelog, which check reads.
    repo.put("CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n");
    repo.put(".gitignore", "node_modules\n");
    fs.mkdirSync(path.join(dir, "node_modules", "@workerstack"), { recursive: true });
    fs.symlinkSync(pkgRoot(), path.join(dir, "node_modules", "@workerstack", "repo"), "junction");
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    fakes.prompts.isInteractive.mockReturnValue(false);
    process.argv = ["node", "repo", "check"];
    // The version check asks npm; the tests answer for it, with the latest the installed copy is.
    vi.stubGlobal("fetch", latestFetch(pkgVersion()));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return repo;
}
