import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bunPath } from "../../../dev/test-paths";
import { childEnv } from "../../env.ts";
import { git } from "./lessons-kit.ts";

const CLI = fileURLToPath(new URL("../../../bin/repo.ts", import.meta.url));

export const OLDER = "## [0.1.0] - 2026-10-01\n\n### Added\n\n- old\n";
export const FILLED = `# Changelog\n\n## [Unreleased]\n\n### Added\n\n- a\n\n${OLDER}`;
export const EMPTY = `# Changelog\n\n## [Unreleased]\n\n${OLDER}`;

/** How a temp repo is made: committed or not, a public or private root package, a public `packages/pub`. */
export type RepoOptions = { commit?: boolean; rootPublic?: boolean; pub?: boolean };

/** Fills `root` with a git repo of the files and the public root package, and `packages/pub` when `pub` is not false. */
export function plantRepo(root: string, files: Record<string, string> = {}, options: RepoOptions = {}): void {
  const { commit = true, rootPublic = true, pub = true } = options;
  const base = {
    "CHANGELOG.md": FILLED,
    "package.json": JSON.stringify(rootPublic ? { name: "root" } : { name: "root", private: true }),
    "x.ts": "x\n",
  };

  const inPub = {
    "packages/pub/CHANGELOG.md": EMPTY,
    "packages/pub/package.json": JSON.stringify({ name: "pub" }),
    "packages/pub/x.ts": "x\n",
  };

  for (const [file, text] of Object.entries({ ...base, ...(pub ? inPub : {}), ...files })) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }

  git(root, "init", "-q");

  if (commit) {
    git(root, "add", "-A");
    git(root, "commit", "-qm", "init");
  }
}

/** The names of the staged files of the repo at `root`. */
export function stagedNames(root: string): string[] {
  const r = spawnSync("git", ["diff", "--cached", "--name-only"], { cwd: root, encoding: "utf8" });

  return r.stdout.split("\n").filter((line) => line !== "");
}

/** `bun repo changelog <args>` run from `cwd` with the session variables that point at the real checkout unset. */
export function runChangelog(cwd: string, ...args: string[]) {
  const env = childEnv({ CLAUDE_PROJECT_DIR: undefined, GROK_WORKSPACE_ROOT: undefined });
  const r = spawnSync(bunPath(), [CLI, "changelog", ...args], { cwd, encoding: "utf8", env });

  return { code: r.status, err: r.stderr, out: r.stdout };
}
