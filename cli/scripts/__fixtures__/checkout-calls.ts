// The calls and replies of the main-checkout guard suites: one session, every harness's shape of a write or a shell.
import fs from "node:fs";
import path from "node:path";
import type { HookInput } from "../hook-input.ts";
import { agyCall, claudeCall, codexCall, cursorCall, inSession, patchAdd } from "./hook-payload.ts";

/** The session every checkout suite sends from. */
export const SID = "mc1";

/** The reason a git stash gets in the main checkout. */
export const STASH_REASON =
  "git stash in the main checkout can destroy other sessions' work: do it inside your worktree, or run it here only when the user's message asks for git stash";

/** A gate answer that denies for `reason`. */
export function deny(reason: string) {
  return { type: "deny", reason };
}

/** The reason a product write gets in the main checkout `r`. */
export function reasonOf(r: string): string {
  return `the main checkout is shared: run bun repo worktree add <name> and write under ${path.join(r, ".worktrees", "<name>")}; only ${path.join(r, ".repo")}${path.sep}{plans,plans-fast,roadmaps,roadmaps-fast,handoffs,implementations,scratch,tmp}${path.sep} is writable here`;
}

/** The session's git-asked.json under the checkout `r`. */
export function askedFile(r: string): string {
  return path.join(r, ".repo/tmp/sessions", SID, "git-asked.json");
}

/** Writes `text` as the session's git-asked.json. */
export function ask(r: string, text: string): void {
  fs.mkdirSync(path.dirname(askedFile(r)), { recursive: true });
  fs.writeFileSync(askedFile(r), text);
}

export function claudeWrite(cwd: string, file: string, extra: HookInput = {}): HookInput {
  return { ...inSession(claudeCall(cwd, "Write", { file_path: file, content: "x" }), SID), ...extra };
}

export function codexPatch(cwd: string, file: string, extra: HookInput = {}): HookInput {
  return { ...inSession(codexCall(cwd, "apply_patch", { command: patchAdd(file) }), SID), ...extra };
}

export function cursorWrite(cwd: string, file: string): HookInput {
  return inSession(cursorCall(cwd, "Write", { file_path: file, content: "x" }), SID);
}

export function claudeSh(cwd: string, command: string, extra: HookInput = {}): HookInput {
  return { ...inSession(claudeCall(cwd, "Bash", { command }), SID), ...extra };
}

export function cursorSh(cwd: string, command: string): HookInput {
  return inSession(cursorCall(cwd, "Shell", { command }), SID);
}

export function agyWrite(r: string, file: string, extra: HookInput = {}): HookInput {
  return { ...agyCall(r, "write_file", { Path: file, Content: "x" }), ...extra };
}

export function agyEdit(r: string, file: string): HookInput {
  return agyCall(r, "edit_file", { Path: file, Target: "a", Replacement: "b" });
}

export function agySh(r: string, command: string, extra: HookInput = {}): HookInput {
  return { ...agyCall(r, "run_command", { CommandLine: command, Cwd: r }), ...extra };
}
