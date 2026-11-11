import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { main as gateMain, processHookPayload } from "./gate-fat-tools.ts";
import { answerDeny, type HookOutput } from "./gate-harness.ts";
import { DENY_FILE_BYTES, REASON_DENYLIST, REASON_FILE_SIZE, REASON_REREAD } from "./gate.constants.ts";
import { useTmp } from "./fixtures/gate-workspace.ts";
import { cursorCall, inSession, replyCommand, replyInput } from "./fixtures/hook-payload.ts";
import { runHook } from "./fixtures/run-hook.ts";

const tmp = useTmp();
const deniedPath = ["node", "modules/x/package.json"].join("_");
const JOB_EXEC = /node_modules\/\.bin\/repo job --job exec --query /;
const WORKTREE_REASON = /^worktrees live in .*[\\/]\.worktrees[\\/]<name> on branch wt\/<name>: run bun /;
const ENV = { CLAUDE_PROJECT_DIR: "", GROK_WORKSPACE_ROOT: "" };
const payload = (cwd: string, tool: string, input: Record<string, unknown>) =>
  inSession(cursorCall(cwd, tool, input), "cu1");
const cursor = (cwd: string, tool: string, input: Record<string, unknown>) =>
  processHookPayload(payload(cwd, tool, input));
const denial = (reason: string) => ({ permission: "deny", user_message: reason, agent_message: reason });

function expectDenial(out: HookOutput | null, reason: RegExp) {
  expect(out?.permission).toBe("deny");
  expect(out?.user_message).toMatch(reason);
  expect(out?.agent_message).toMatch(reason);
}

function repo() {
  const r = tmp.repo("gate-cursor-");
  fs.writeFileSync(path.join(r, ".gitignore"), ".tmp/\n");
  const a = path.join(r, "packages/a");
  fs.mkdirSync(a, { recursive: true });
  fs.writeFileSync(path.join(a, "big.log"), "x".repeat(DENY_FILE_BYTES + 1024));
  fs.writeFileSync(path.join(a, "small.md"), "x\n");
  return { r, a, scratch: (rel: string) => path.join(r, ".tmp/repo", rel) };
}

it("denies a Shell dump of a denylisted path in Cursor's reply shape", () => {
  const { a } = repo();
  expect(cursor(a, "Shell", { command: "cat bun.lock", cwd: a })).toStrictEqual(denial(REASON_DENYLIST));
  expect(cursor(a, "Shell", { command: `cat ${deniedPath}` })).toStrictEqual(denial(REASON_DENYLIST));
  expect(cursor(a, "Shell", { command: "curl" })).toStrictEqual(denial(REASON_DENYLIST));
});

it("rewrites a Shell dump, a web fetch and ls in the nested form, never with permission", () => {
  const { a } = repo();
  const shell = (command: string) => cursor(a, "Shell", { command });
  expect(shell("cat small.md")?.hookSpecificOutput?.hookEventName).toBe("PreToolUse");
  expect(replyCommand(shell("cat small.md"))).toMatch(JOB_EXEC);
  expect(replyCommand(shell("curl https://example.com/x"))).toMatch(
    /node_modules\/\.bin\/repo job --job fetch --query /,
  );
  expect(replyInput(shell("ls src"))).toStrictEqual({ command: "rtk ls src" });
  for (const command of ["cat small.md", "ls src"]) {
    const out = shell(command);
    expect(Object.keys(out ?? {})).toStrictEqual(["hookSpecificOutput"]);
    expect(out?.hookSpecificOutput?.permissionDecision).toBeUndefined();
  }
  expect(shell("git status")).toBeNull();
});

it("redirects a nested Write to the root scratch with no permission field", () => {
  const { r, a, scratch } = repo();
  const typed = path.join(a, ".tmp/repo/scratch/x.md");
  const nested = { hookEventName: "PreToolUse", updatedInput: { file_path: scratch("scratch/x.md"), content: "hi" } };
  expect(cursor(a, "Write", { file_path: typed, content: "hi" })).toStrictEqual({ hookSpecificOutput: nested });
  const root = { hookEventName: "PreToolUse", updatedInput: { file_path: scratch("notes.md"), content: "hi" } };
  expect(cursor(r, "Write", { file_path: "notes.md", content: "hi" })).toStrictEqual({ hookSpecificOutput: root });
  expect(cursor(a, "Write", { file_path: path.join(a, "src.ts"), content: "hi" })).toBeNull();
  expect(fs.existsSync(path.join(a, ".tmp"))).toBe(false);
  expect(fs.existsSync(path.join(r, ".tmp/repo/scratch"))).toBe(false);
});

it("denies Read and Grep on a denylisted path and Read of a file over 200KB", () => {
  const { a } = repo();
  expect(cursor(a, "Read", { file_path: deniedPath })).toStrictEqual(denial(REASON_DENYLIST));
  expect(cursor(a, "Read", { file_path: "bun.lock" })).toStrictEqual(denial(REASON_DENYLIST));
  expect(cursor(a, "Grep", { pattern: "x", file_path: "dist" })).toStrictEqual(denial(REASON_DENYLIST));
  expect(cursor(a, "Grep", { pattern: "x", glob: "node_modules/**" })).toStrictEqual(denial(REASON_DENYLIST));
  expect(cursor(a, "Read", { file_path: path.join(a, "big.log") })).toStrictEqual(denial(REASON_FILE_SIZE));
});

it("injects no limit into Read or Grep, which Cursor cannot take", () => {
  const { a } = repo();
  expect(cursor(a, "Read", { file_path: path.join(a, "small.md") })).toBeNull();
  expect(cursor(a, "Grep", { pattern: "x", file_path: "src" })).toBeNull();
  expect(cursor(a, "Grep", { pattern: "x", head_limit: 9999 })).toBeNull();
});

it("denies a Read of a file this session wrote with a reason that works without offset or limit", () => {
  const { a } = repo();
  const file = path.join(a, "small.md");
  expect(cursor(a, "Write", { file_path: file, content: "x\n" })).toBeNull();
  const out = cursor(a, "Read", { file_path: file });
  expect(out?.permission).toBe("deny");
  expect(out?.user_message).toBe(out?.agent_message);
  expect(out?.user_message).toMatch(/already wrote this session/);
  expect(out?.user_message).toMatch(/node_modules\/\.bin\/repo job --job exec --query 'sed -n 1,200p /);
  expect(out?.user_message).not.toContain(REASON_REREAD);
  expect(out?.user_message).toContain(file.split(path.sep).join("/"));
  const other = inSession(cursorCall(a, "Read", { file_path: file }), "other");
  expect(processHookPayload(other)).toBeNull();
});

it("holds every deny guard for Cursor payloads", () => {
  const { r, a } = repo();
  fs.mkdirSync(path.join(r, "packages/c"), { recursive: true });
  const nested = path.join(a, ".gitignore");
  const rule = `${path.join(r, ".gitignore")}:1 .tmp/`;
  for (const out of [
    cursor(a, "Write", { file_path: nested, content: ".tmp/\n" }),
    cursor(a, "Shell", { command: "echo .tmp/ > .gitignore", cwd: a }),
  ]) {
    expect(out?.permission).toBe("deny");
    expect(out?.agent_message).toContain(rule);
  }
  expectDenial(cursor(r, "Shell", { command: "git worktree add ../elsewhere" }), WORKTREE_REASON);
  expect(cursor(r, "Shell", { command: "git worktree add .worktrees/y -b wt/y" })).toBeNull();
  expect(fs.existsSync(nested)).toBe(false);
});

it("skips tools it does not answer", () => {
  const { a } = repo();
  for (const name of ["List", "Delete", "Glob", "Bash"]) {
    expect(cursor(a, name, { file_path: "node_modules" })).toBeNull();
  }
});

it("answers on stdout in the same shape and stays silent on a pass", () => {
  const { a } = repo();
  const data = payload(a, "Shell", { command: "cat bun.lock", cwd: a });
  const out = runHook(gateMain, data, ENV);
  expect(out.status).toBe(0);
  expect(JSON.parse(out.stdout)).toStrictEqual(answerDeny(data, REASON_DENYLIST));
  expect(JSON.parse(out.stdout)).toStrictEqual(denial(REASON_DENYLIST));
  const pass = runHook(gateMain, payload(a, "Shell", { command: "git status" }), ENV);
  expect(pass.status).toBe(0);
  expect(pass.stdout).toBe("");
});
