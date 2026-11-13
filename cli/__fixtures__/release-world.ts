import path from "node:path";
import { releaseMain } from "../release/release.ts";
import { spawnRunner } from "../scripts/ci-wait-run.ts";
import type { Runner } from "../scripts/ci-wait.ts";
import { git as plantedGit, tempDir, write } from "./planted-repo.ts";

export const NAME = "@acme/app";
export const UNRELEASED_ADDED = "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- x\n\n## [0.1.0] - 2026-10-01\n\n### Added\n\n- first\n";
export const EMPTY_UNRELEASED = "# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-10-01\n\n### Added\n\n- first\n";

/** A repo at 0.1.0 (tagged unless `tagged` is false) with a bare origin, its first release already out. */
export type World = { work: string; remote: string };

/** Files the world starts with, written over by `files`. */
export function world(files: Record<string, unknown> = {}, tagged = true): World {
  const dir = tempDir();
  const remote = path.join(dir, "remote.git");
  const work = path.join(dir, "work");
  plantedGit(dir, "init", "-q", "--bare", "-b", "main", remote);
  plantedGit(dir, "init", "-q", "-b", "main", work);
  // The release commits in this checkout with the process's git, so the identity lives in the repo, not in a global config a runner lacks.
  plantedGit(work, "config", "user.name", "t");
  plantedGit(work, "config", "user.email", "t@t");
  plantedGit(work, "config", "commit.gpgsign", "false");
  plantedGit(work, "config", "tag.gpgsign", "false");
  plantedGit(work, "remote", "add", "origin", remote);
  write(work, {
    "package.json": { name: NAME, version: "0.1.0" },
    "repo.config.ts": 'export default { packs: ["release"] };\n',
    "CHANGELOG.md": EMPTY_UNRELEASED,
    ...files,
  });
  plantedGit(work, "add", "-A");
  plantedGit(work, "commit", "-q", "-m", "chore: init");
  plantedGit(work, "push", "-q", "-u", "origin", "main");
  plantedGit(work, "remote", "set-head", "origin", "main");
  if (tagged) {
    plantedGit(work, "tag", "-a", `${NAME}@0.1.0`, "-m", "first");
    plantedGit(work, "push", "-q", "origin", "--tags");
  }
  return { work, remote };
}

/** Writes `files`, commits them as `subject` and pushes. */
export function commit(w: World, subject: string, files: Record<string, unknown>, push = true): void {
  write(w.work, files);
  plantedGit(w.work, "add", "-A");
  plantedGit(w.work, "commit", "-q", "-m", subject);
  if (push) plantedGit(w.work, "push", "-q", "origin", "main");
}

/** A pushed feat with an entry under Unreleased. */
export function feat(w: World, push = true): void {
  commit(w, "feat: add x", { "src/x.ts": "export const x = 1;\n", "CHANGELOG.md": UNRELEASED_ADDED }, push);
}

export const gitIn = (cwd: string, ...args: string[]): string => plantedGit(cwd, ...args).trim();
/** Where the checkout and its origin stand: enough to prove a refused run wrote nothing. */
export const snapshot = (w: World) => ({
  head: gitIn(w.work, "rev-parse", "HEAD"),
  status: gitIn(w.work, "status", "--porcelain"),
  tags: gitIn(w.work, "tag", "-l"),
  remoteTags: gitIn(w.remote, "tag", "-l"),
  remoteMain: gitIn(w.remote, "rev-parse", "main"),
});

/** What the fake gh answers: a ci run for any commit, ending as `conclusion`. */
export type Behavior = {
  auth?: boolean;
  run?: boolean;
  conclusion?: string;
  /** Open pull requests for the branch; none when omitted. */
  prs?: number;
  /** Called when the run is looked at, to see what exists then. */
  onWatch?: () => void;
};
const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
const BAD = { code: 1, stdout: "", stderr: "no" };
const RUN = { databaseId: 7, createdAt: "2026-11-09T10:00:00Z", headBranch: "main" };

export function fakeGh(b: Behavior = {}): Runner {
  return (args) => {
    const key = args.join(" ");
    if (key === "auth status") return b.auth === false ? BAD : ok();
    if (key.startsWith("pr list")) return ok(JSON.stringify(Array.from({ length: b.prs ?? 0 }, (_, number) => ({ number }))));
    if (key.startsWith("run list --commit")) return ok(JSON.stringify(b.run === false ? [] : [RUN]));
    if (key.startsWith("run list --branch")) {
      return ok(JSON.stringify([RUN, { databaseId: 8, createdAt: "2026-11-09T10:05:00Z" }]));
    }
    if (key.startsWith("run view 7 --json")) {
      b.onWatch?.();
      const conclusion = b.conclusion ?? "success";
      return ok(JSON.stringify({ status: "completed", conclusion, jobs: [{ name: "test", conclusion }] }));
    }
    return key.startsWith("run view 7 --log-failed") ? ok("boom\n") : BAD;
  };
}

/** Runs `repo release` in the world's checkout; the exit code and what it printed. */
export async function release(w: World, argv: string[], gh: Runner = fakeGh()) {
  const out: string[] = [];
  const err: string[] = [];
  let clock = Date.UTC(2026, 10, 9);
  const code = await releaseMain(argv, {
    cwd: w.work,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    git: spawnRunner("git"),
    gh,
    now: () => clock,
    sleep: (ms) => ((clock += ms), Promise.resolve()),
  });
  return { code, out: out.join(""), err: err.join("") };
}
