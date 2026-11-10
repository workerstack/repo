import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { childEnv } from "../env.ts";
import { toolEnv } from "../scripts/tool-env.ts";
import { FIXTURES_SEGMENT, GREP_ARGS, NUL } from "./header-stale.constants.ts";
import { LEGACY_HEADERS, OWNED_TOKEN } from "./header.constants.ts";
import { hasOwnedHeader } from "./header.ts";
import { normalizeRel } from "./manifest.ts";
import type { Output } from "./outputs.ts";
import type { GitRun } from "./standards.ts";

/**
 * Git at `root` with every `GIT_*` variable dropped, so a sync a git hook runs reads its own checkout, not the repo
 * being committed; a git that cannot start is a null status, whose output nothing reads.
 */
const ownGit: GitRun = (root, args, input) => {
  const result = spawnSync("git", [...args], { cwd: root, encoding: "utf8", input, env: toolEnv(childEnv()) });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

/**
 * The tracked files under `root` that carry sync's header line, new or legacy, and that no output names: what an
 * earlier version wrote and this one dropped, found with no manifest, so a fresh clone prunes them too. A file under
 * a `fixtures` segment is test data and stays; outside a git repo, or when git finds nothing, there are none.
 */
export function headerStale(root: string, outputs: readonly Output[], git: GitRun = ownGit): string[] {
  const patterns = [OWNED_TOKEN, ...LEGACY_HEADERS].flatMap((line) => ["-e", line]);
  const result = git(root, [...GREP_ARGS, ...patterns]);
  if (result.status !== 0) return [];
  const named = new Set(outputs.map((output) => output.path));
  return result.stdout.split(NUL).flatMap((raw) => {
    const rel = normalizeRel(raw, root);
    if (rel === null || named.has(rel) || rel.split("/").includes(FIXTURES_SEGMENT)) return [];
    return isOwned(path.join(root, rel)) ? [rel] : [];
  });
}

/** Whether the file at `abs` reads and opens with sync's header line. */
function isOwned(abs: string): boolean {
  try {
    return hasOwnedHeader(fs.readFileSync(abs, "utf8"));
  } catch {
    return false;
  }
}
