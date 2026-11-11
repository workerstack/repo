import { afterEach, expect, it } from "vitest";
import { scratch } from "./fixtures/worktree-repo.ts";
import { sharedGitReason } from "./worktree-guards.ts";

const tmp = scratch();
afterEach(() => tmp.cleanup());

const COMMIT = /^the main checkout is shared: commit inside /;
const STASH = /^git stash in the main checkout can destroy/;

/** The deny reason for `command` run in the root of a fresh repo, nothing asked for. */
function reasonFor(command: string, root = tmp.repo()): string | null {
  return sharedGitReason(command, { roots: { root, cwd: root }, cwd: root, asked: new Set() });
}

it("reads a command after a here-string, an escaped <<, a quoted <<, or a bare << as a command", () => {
  const r = tmp.repo();
  for (const opener of ['cat <<< "x"', "echo \\<<EOF", 'echo "<<EOF"', "echo '<<EOF'", "cat <<"]) {
    expect(reasonFor(`${opener}\ngit commit -m y`, r), opener).toMatch(COMMIT);
  }
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
    "git commit\\",
    'git "commit" -m x',
    "git 'com'mit",
  ]) {
    expect(reasonFor(command, r), command).toMatch(COMMIT);
  }
});

it("skips global flags to find the subcommand, and passes a line with none", () => {
  const r = tmp.repo();
  expect(reasonFor("git --no-pager -c a=b commit -m x", r)).toMatch(COMMIT);
  expect(reasonFor("git -c a=b", r)).toBeNull();
  expect(reasonFor("git", r)).toBeNull();
  expect(reasonFor("FOO=1", r)).toBeNull();
  expect(reasonFor("git -C", r)).toBeNull();
  expect(reasonFor('git -C "$DIR" commit', r)).toBeNull();
  expect(reasonFor("echo hi && git commit", r)).toMatch(COMMIT);
});
