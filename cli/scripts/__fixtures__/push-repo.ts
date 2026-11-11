/** Temp git repos with a bare origin for the `repo push` tests: branches with set commit dates, and what origin holds. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { useTempDirs } from "../../__fixtures__/temp-dirs.ts";

/** One day in milliseconds. */
export const DAY = 86_400_000;

/** A work repo `dir` cloned from the bare `origin`, on `main` with one commit pushed. */
export type PushRepo = {
  readonly dir: string;
  readonly origin: string;
  /** Runs git in the work repo and returns its trimmed stdout. */
  readonly git: (args: string[]) => string;
  /** Checks out `branch` (made from HEAD when new) and commits on it, dated `daysAgo` before the repo's now. */
  readonly commitOn: (branch: string, daysAgo: number) => string;
  /** The commit origin's `branch` points at, or null when origin has no such branch. */
  readonly originSha: (branch: string) => string | null;
  /** The upstream `branch` tracks, or null when it has none. */
  readonly upstream: (branch: string) => string | null;
  /** Installs a pre-push hook that refuses every push. */
  readonly refusePushes: () => void;
};

type RepoOptions = {
  /** The clock commit dates count back from, in milliseconds. */
  now: number;
  /** Whether origin/HEAD is set; false leaves origin with no default branch. */
  setHead?: boolean;
  /** The folder under the temp dir that holds the work repo. */
  sub?: string | undefined;
};

const IDENTITY = { GIT_AUTHOR_EMAIL: "t@t", GIT_AUTHOR_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_COMMITTER_NAME: "t" };

function gitIn(cwd: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...IDENTITY, ...env } }).trim();
}

function maybe(cwd: string, args: string[]): string | null {
  try {
    return gitIn(cwd, args);
  } catch {
    return null;
  }
}

/** Per test file: makers of push repos, removed after each test. */
export function usePushRepos(): { repo: (options: RepoOptions) => PushRepo; tempDir: () => string } {
  const { tempDir } = useTempDirs("push-");
  function repo({ now, setHead = true, sub = "work" }: RepoOptions): PushRepo {
    const root = tempDir();
    const origin = path.join(root, "origin.git");
    const dir = path.join(root, sub);
    fs.mkdirSync(dir, { recursive: true });
    gitIn(root, ["init", "-q", "--bare", "-b", "main", origin]);
    gitIn(dir, ["init", "-q", "-b", "main"]);
    const hooks = path.join(dir, ".git", "hooks");
    for (const [key, value] of [
      ["core.hooksPath", hooks],
      ["commit.gpgsign", "false"],
      ["push.default", "simple"],
    ] as const)
      gitIn(dir, ["config", key, value]);
    gitIn(dir, ["remote", "add", "origin", origin]);
    let count = 0;
    const commitOn = (branch: string, daysAgo: number): string => {
      const current = maybe(dir, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
      const exists = maybe(dir, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]) !== null;
      if (current !== branch) gitIn(dir, exists ? ["checkout", "-q", branch] : ["checkout", "-q", "-b", branch]);
      fs.writeFileSync(path.join(dir, `file-${++count}.txt`), `${branch} ${count}\n`);
      gitIn(dir, ["add", "-A"]);
      const date = `@${Math.floor((now - daysAgo * DAY) / 1000)} +0000`;
      gitIn(dir, ["commit", "-q", "-m", `chore: ${branch} ${count}`], {
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      });
      return gitIn(dir, ["rev-parse", "HEAD"]);
    };
    commitOn("main", 30);
    gitIn(dir, ["push", "-q", "-u", "origin", "main"]);
    if (setHead) gitIn(dir, ["remote", "set-head", "origin", "main"]);
    return {
      commitOn,
      dir,
      git: (args) => gitIn(dir, args),
      origin,
      originSha: (branch) => maybe(origin, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]),
      refusePushes: () => {
        fs.mkdirSync(hooks, { recursive: true });
        fs.writeFileSync(path.join(hooks, "pre-push"), "#!/bin/sh\necho 'pre-push: refused' >&2\nexit 1\n", {
          mode: 0o755,
        });
      },
      upstream: (branch) => maybe(dir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${branch}@{upstream}`]),
    };
  }
  return { repo, tempDir };
}
