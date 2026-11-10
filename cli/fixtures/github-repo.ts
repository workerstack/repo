import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Temp checkouts made by `githubRepo`, for the test's `afterEach` to remove. */
export const GITHUB_TEMPS: string[] = [];

export const GITHUB_ORIGIN = "https://github.com/workerstack/repo.git";
export const KEYWORDS = ["agents", "workerstack", "monorepo", "lint", "ci"];

/** A public package with the release pack: its CI reports test x3, commits, skips, no-node and consumer. */
export const MANIFEST = {
  name: "pkg",
  private: false,
  description: "Agent workflow, code standards",
  homepage: "https://github.com/workerstack/repo",
  keywords: KEYWORDS,
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
