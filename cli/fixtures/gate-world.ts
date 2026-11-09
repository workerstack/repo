import { gate } from "../release/gate.ts";
import { spawnRunner } from "../scripts/ci-wait-run.ts";
import type { Runner } from "../scripts/ci-wait.ts";
import { commit, fakeGh, gitIn, NAME, type Behavior, type World } from "./release-world.ts";

const CHANGELOG = (version: string): string =>
  `# Changelog\n\n## [Unreleased]\n\n## [${version}] - 2026-11-09\n\n### Added\n\n- x\n\n## [0.1.0] - 2026-10-01\n\n### Added\n\n- first\n`;

/** A gh that answers `repo view` with `branch` as the default branch (a failure for null) and the rest as the release world's. */
export function ghFor(branch: string | null, behavior: Behavior = {}, calls: string[] = []): Runner {
  const rest = fakeGh(behavior);
  return (args, cwd) => {
    calls.push(args.join(" "));
    if (args[0] !== "repo") return rest(args, cwd);
    const body = JSON.stringify({ defaultBranchRef: { name: branch } });
    return branch === null ? { code: 1, stdout: "", stderr: "not found" } : { code: 0, stdout: body, stderr: "" };
  };
}

/** What a release commit holds: the version in package.json, the tag's version, and whether it reaches origin. */
export type Tagged = { version: string; tagVersion?: string; push?: boolean; changelog?: boolean };

/** Commits `version` with its changelog section (unless `changelog` is false), tags it, and returns the short sha. */
export function tagRelease(w: World, { version, tagVersion = version, push = true, changelog = true }: Tagged): string {
  const files = { "package.json": { name: NAME, version }, ...(changelog ? { "CHANGELOG.md": CHANGELOG(version) } : {}) };
  commit(w, `chore: release ${version}`, files, push);
  gitIn(w.work, "tag", "-a", `${NAME}@${tagVersion}`, "-m", "t");
  return gitIn(w.work, "rev-parse", "--short=7", "HEAD");
}

/** Runs `repo release gate` in the world's checkout with fakes of gh, the clock and the sleep. */
export async function runGate(w: World, argv: string[], runner: Runner = ghFor("main")) {
  const out: string[] = [];
  const err: string[] = [];
  let clock = 0;
  const code = await gate(argv, {
    cwd: w.work,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    git: spawnRunner("git"),
    gh: runner,
    now: () => clock,
    sleep: (ms) => ((clock += ms), Promise.resolve()),
  });
  return { code, out: out.join(""), err: err.join("") };
}

export const refused = (line: string) => ({ code: 1, out: "", err: `repo release gate: ${line}\n` });
