import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Temp checkouts made by `githubRepo`, for the test's `afterEach` to remove. */
export const GITHUB_TEMPS: string[] = [];

export const GITHUB_ORIGIN = "https://github.com/workerstack/repo.git";
export const KEYWORDS = ["agents", "ci", "lint", "monorepo", "workerstack"];

/** A public package with the release pack: its CI reports test x10, commits, skips, coverage and consumer. */
export const MANIFEST = {
  name: "pkg",
  private: false,
  description: "Agent workflow, code standards",
  homepage: "https://github.com/workerstack/repo",
  keywords: KEYWORDS,
  devDependencies: { vitest: "^5.1.0" },
};

/** The files of a checkout with the evals pack on beside release. */
export const EVALS_FILES: Record<string, string> = {
  "workerstack.config.ts": 'export default { packs: ["release", "evals"] };\n',
};

type Options = { origin?: string | null; files?: Record<string, string> };

/** A git checkout under a temp dir with an origin, a release-pack config and `MANIFEST` unless `files` replaces them. */
export function githubRepo({ origin = GITHUB_ORIGIN, files = {} }: Options = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-github-"));
  GITHUB_TEMPS.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  if (origin !== null) execFileSync("git", ["remote", "add", "origin", origin], { cwd: dir });
  const all = {
    "workerstack.config.ts": 'export default { packs: ["release"] };\n',
    "package.json": JSON.stringify(MANIFEST),
    ...files,
  };
  for (const [rel, text] of Object.entries(all)) fs.writeFileSync(path.join(dir, rel), text);
  return dir;
}
