import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { addOrigin, captured, commitIn, git, hasTracking, scratch } from "./__fixtures__/worktree-repo.ts";
import { dropRemoteBranch } from "./worktree-git.ts";
import { syncRoot } from "./worktree-setup.ts";
import { BIN_DIR } from "./worktree.constants.ts";

const tmp = scratch();

afterEach(() => tmp.cleanup());

const MARKER_JS = "require('fs').writeFileSync('synced.marker', process.argv.slice(2).join(' '));\n";

/** A repo whose origin holds `wt/a`, with its tracking ref. */
function withRemoteBranch(): string {
  const r = tmp.repo();
  git(r, "branch", "wt/a");
  addOrigin(r, tmp.dir("origin-"), ["wt/a"]);

  return r;
}

it("deletes origin's branch and its tracking ref, and says nothing", () => {
  const r = withRemoteBranch();
  const { stderr } = captured(() => dropRemoteBranch(r, "wt/a"));
  expect(stderr).toBe("");
  expect(git(r, "ls-remote", "--heads", "origin", "wt/a")).toBe("");
  expect(hasTracking(r, "wt/a")).toBe(false);
});

it("does nothing when origin has no tracking ref of the branch", () => {
  const r = tmp.repo();
  const { stderr } = captured(() => dropRemoteBranch(r, "wt/a"));
  expect(stderr).toBe("");
});

it("warns with git's reason when origin refuses", () => {
  const r = withRemoteBranch();
  git(r, "remote", "set-url", "origin", path.join(r, "no-such-origin"));
  const { stderr } = captured(() => dropRemoteBranch(r, "wt/a"));
  expect(stderr).toMatch(/^could not delete origin's wt\/a: .+; run git push origin --delete wt\/a\n$/);
  expect(stderr).not.toContain("no answer in time");
});

// On win32 the killed git's ssh child keeps the repo dir busy, so its cleanup fails; the branch is the same elsewhere.
it.skipIf(process.platform === "win32")("warns that origin did not answer when the delete runs out of time", () => {
  const r = withRemoteBranch();
  git(r, "remote", "set-url", "origin", "ssh://hang.invalid/x.git");
  vi.stubEnv("GIT_SSH_COMMAND", "sleep 1 #");
  const { stderr } = captured(() => dropRemoteBranch(r, "wt/a", 100));
  expect(stderr).toBe("could not delete origin's wt/a: no answer in time; run git push origin --delete wt/a\n");
});

/** A repo whose package.json holds `manifest`. */
function rootWith(manifest: string): string {
  const r = tmp.repo();
  commitIn(r, "repo-marker.js", MARKER_JS);
  fs.writeFileSync(path.join(r, "package.json"), manifest);

  return r;
}

it("runs bun repo sync through the root's repo script", () => {
  const r = rootWith(JSON.stringify({ scripts: { repo: "node repo-marker.js" } }));
  const { stderr } = captured(() => syncRoot(r));
  expect(stderr).toBe("");
  expect(fs.readFileSync(path.join(r, "synced.marker"), "utf8")).toBe("sync");
});

it("warns when the sync fails", () => {
  const r = rootWith(JSON.stringify({ scripts: { repo: `node -e "process.exit(1)"` } }));
  const { stderr } = captured(() => syncRoot(r));
  expect(stderr).toBe(`could not sync ${r}: run bun repo sync there\n`);
});

it.each([
  ["no package.json", null],
  ["a package.json with no repo script", JSON.stringify({ scripts: { build: "node repo-marker.js" } })],
  ["a package.json that is not JSON", "{"],
])("skips a root with %s and says nothing", (_name, manifest) => {
  const r = manifest === null ? tmp.repo() : rootWith(manifest);
  const { stderr } = captured(() => syncRoot(r));
  expect(stderr).toBe("");
  expect(fs.existsSync(path.join(r, "synced.marker"))).toBe(false);
});

it("counts a repo.exe bin as a way to run bun repo, and warns when it cannot sync", () => {
  const r = tmp.repo();
  const bin = path.join(r, BIN_DIR, "repo.exe");
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, "");
  const { stderr } = captured(() => syncRoot(r));
  expect(stderr).toBe(`could not sync ${r}: run bun repo sync there\n`);
});
