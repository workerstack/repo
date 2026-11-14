import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { scratch } from "./__fixtures__/worktree-repo.ts";
import { sharedGitReason } from "./worktree-guards.ts";
import { gitLine } from "./worktree-shell.ts";

const tmp = scratch();

afterEach(() => tmp.cleanup());

const COMMIT = /^the main checkout is shared: commit inside /;
const STASH = /^git stash in the main checkout can destroy/;

/** The deny reason for `command` run in the root of a fresh repo, nothing asked for. */
function reasonFor(command: string, root = tmp.repo()): string | null {
  return sharedGitReason(command, { asked: new Set(), cwd: root, roots: { cwd: root, root } });
}

it("reads a command after a here-string, an escaped <<, or a quoted << as a command", () => {
  const r = tmp.repo();

  for (const opener of ['cat <<< "x"', "echo \\<<EOF", 'echo "<<EOF"', "echo '<<EOF'"])
    expect(reasonFor(`${opener}\ngit commit -m y`, r), opener).toMatch(COMMIT);
});

it("runs nothing after a bare << and reads a trailing backslash as part of the word, as bash does", () => {
  const r = tmp.repo();

  expect(reasonFor("cat <<\ngit commit -m y", r)).toBeNull();
  expect(reasonFor("git commit\\", r)).toBeNull();
});

it("skips the body of every heredoc form up to its terminator, and reads what follows", () => {
  const r = tmp.repo();
  expect(reasonFor("cat <<EOF\ngit commit -m x\nEOF", r)).toBeNull();
  expect(reasonFor('cat <<"EOF"\ngit commit -m x\nEOF', r)).toBeNull();
  expect(reasonFor("cat <<'EOF'\ngit commit -m x\r\nEOF\r\n", r)).toBeNull();
  expect(reasonFor("cat <<-EOF\n\tgit commit -m x\n\tEOF\ngit stash", r)).toMatch(STASH);
  expect(reasonFor("cat <<A <<B\ngit commit\nA\ngit stash\nB\ngit stash", r)).toMatch(STASH);
});

it("reads quoted, escaped and unterminated words the way the shell does", () => {
  const r = tmp.repo();

  for (const command of [
    "git commit -m 'unterminated",
    'git commit -m "unterminated',
    "git commit -m a\\ b",
    'git "commit" -m x',
    "git 'com'mit",
  ])
    expect(reasonFor(command, r), command).toMatch(COMMIT);
});

it("skips global flags to find the subcommand, and passes a line with none", () => {
  const r = tmp.repo();
  expect(reasonFor("git --no-pager -c a=b commit -m x", r)).toMatch(COMMIT);
  expect(reasonFor("git -c a=b", r)).toBeNull();
  expect(reasonFor("git", r)).toBeNull();
  expect(reasonFor("FOO=1", r)).toBeNull();
  expect(reasonFor("git -C", r)).toBeNull();
  expect(reasonFor('git -C "$DIR" commit', r)).toMatch(COMMIT);
  expect(reasonFor("echo hi && git commit", r)).toMatch(COMMIT);
});

/** The dir and subcommand of each git command in `command`, run from `/r`. */
function dirsOf(command: string): [string, string][] {
  return gitLine(command, "/r", path.posix).commands.map((g) => [g.at.known ? g.at.path : `?${g.at.cause}`, g.sub]);
}

it("moves git's dir by -C, --git-dir, --work-tree and the variables before it, unknown when not literal", () => {
  expect(dirsOf("git --git-dir=/x/.git push")).toStrictEqual([["/x/.git", "push"]]);
  expect(dirsOf("GIT_WORK_TREE=sub git -C /a status")).toStrictEqual([["/a", "status"]]);
  expect(dirsOf("GIT_DIR=sub git status")).toStrictEqual([["/r/sub", "status"]]);
  expect(dirsOf("GIT_DIR=~/x git push")).toStrictEqual([["?~/x", "push"]]);
  expect(dirsOf('git --work-tree="$W" status')).toStrictEqual([['?"$W"', "status"]]);
  expect(dirsOf("git -C")).toStrictEqual([]);
});
