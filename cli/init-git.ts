/** Init's git repo: starts one in the dest when it is not inside a work tree, so the install's sync can set `core.hooksPath`. */
import type { ExecFileSyncOptions } from "node:child_process";

/** The `execFileSync` shape init runs its commands through. */
type Exec = (cmd: string, args: string[], opts: ExecFileSyncOptions) => unknown;

/**
 * Runs `git init -q` in `dest` and then prints one line saying so to `stdout` (the process's stdout when omitted),
 * only when `git rev-parse --is-inside-work-tree` fails there. Inside a work tree it does nothing and says nothing.
 */
export function initGit(dest: string, exec: Exec, stdout: (s: string) => void = (s) => process.stdout.write(s)): void {
  try {
    exec("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dest, stdio: "ignore" });
    return;
  } catch {
    // not inside a work tree: start one below
  }
  exec("git", ["init", "-q"], { cwd: dest, stdio: "inherit" });
  stdout("repo init: ran git init\n");
}
