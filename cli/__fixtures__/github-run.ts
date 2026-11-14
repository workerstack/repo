import { repoGithub } from "../github-apply.ts";
import type { GhFailure } from "../github-gh.ts";
import { GITHUB_TEMPS } from "./github-repo.ts";
import { fakeGh, type FakeGh, type Settings } from "./github-store.ts";
import { removeTemps } from "./remove-temps.ts";

export const DENIED: GhFailure = { ok: false, kind: "http", status: 403, message: "gh: Forbidden (HTTP 403)" };
export const DENIED_LINE =
  "repo github: gh cannot change workerstack/repo's settings (HTTP 403): log in as an admin with `gh auth login`\n";

/** Removes the checkouts `githubRepo` made; a test file passes it to `afterEach`. */
export function cleanGithubTemps(): void {
  removeTemps(GITHUB_TEMPS.splice(0));
}

/** Runs `repo github` in `cwd` against `fake`, returning the exit code and what it printed. */
export async function run(cwd: string, fake: FakeGh, argv: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const io = { cwd, gh: fake.gh, stdout: (t: string) => void out.push(t), stderr: (t: string) => void err.push(t) };
  const code = await repoGithub(argv, io);
  return { code, out: out.join(""), err: err.join("") };
}

/** The settings of a repo `repo github` has run on, but for what `change` overrides. */
export async function settledSettings(cwd: string, change: Partial<Settings> = {}): Promise<Settings> {
  const fake = fakeGh();
  await run(cwd, fake);
  return { ...fake.settings, ...change };
}
