import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { VALID_TMP } from "./fixtures/persist-bodies.ts";
import { must, orchestrateKit, replyOf, type HookOut } from "./fixtures/orchestrate-kit.ts";
import { runHook } from "./fixtures/run-hook.ts";
import { main as gateMain } from "./gate-fat-tools.ts";
import { ASK_STOP_REASON, SESSION_GATE_STAMP } from "./orchestrate.constants.ts";

const kit = orchestrateKit();

/** A git repo holding a dump-sized log at `dir` under it; returns the repo root. */
function repo(dir = ""): string {
  const r = fs.realpathSync(kit.temp());
  spawnSync("git", ["init", "-q"], { cwd: r });
  fs.mkdirSync(path.join(r, dir), { recursive: true });
  fs.writeFileSync(path.join(r, dir, "big.log"), "x\n".repeat(10));
  return r;
}

it("answers a Codex Bash rewrite with allow", () => {
  const a = path.join(repo("packages/a"), "packages/a");
  const call = { session_id: "cx", turn_id: "t1", model: "m", hook_event_name: "PreToolUse", cwd: a };
  const json = must(replyOf(kit.run({ ...call, tool_name: "Bash", tool_input: { command: "cat big.log" } })));
  expect(json.hookSpecificOutput.permissionDecision).toBe("allow");
  expect(json.hookSpecificOutput.updatedInput.command).toMatch(/node_modules\/\.bin\/repo job --job exec --query /);
});

it("denies a Grok git worktree add outside .worktrees", () => {
  const r = repo("packages/a");
  const toolInput = { command: "git worktree add ../elsewhere" };
  const call = { hookEventName: "PreToolUse", toolName: "run_terminal_command", toolInput, cwd: r };
  const out = must(replyOf(kit.run(call, { GROK_HOOK_EVENT: "PreToolUse" })));
  expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/^worktrees live in /);
});

// Antigravity's stdin names no hook event, so orchestrate-parent stays silent and the gate answers alone.
it("leaves Antigravity calls to the gate", () => {
  const r = repo("packages/a");
  const a = path.join(r, "packages/a");
  for (const toolCall of [
    { name: "run_command", args: { CommandLine: "cat big.log", Cwd: a } },
    { name: "edit_file", args: { Path: path.join(a, ".tmp/repo/scratch/x.md"), Target: "a", Replacement: "b" } },
  ]) {
    const payload = { conversationId: "ag", workspacePaths: [r], toolCall };
    expect(runHook(gateMain, payload).stdout, toolCall.name).not.toBe("");
    expect(kit.run(payload).stdout, toolCall.name).toBe("");
  }
  expect(fs.existsSync(path.join(a, ".tmp"))).toBe(false);
});

// Cursor sends cursor_version and its own camelCase event names. Whatever the hook prints must be empty or a
// reply Cursor accepts: its native deny, Claude's nested form with no top-level field, or decision:block on stop.
const cursor = (cwd: string, event: string, extra: object = {}): HookOut | null =>
  replyOf(
    kit.run(
      { cursor_version: "2026.11.05", session_id: "cu", model: "m", cwd, hook_event_name: event, ...extra },
      { CLAUDE_PROJECT_DIR: "", GROK_WORKSPACE_ROOT: "" },
    ),
  );
function nested(reply: HookOut): void {
  expect(Object.keys(reply)).toStrictEqual(["hookSpecificOutput"]);
  expect(reply.hookSpecificOutput.permissionDecision).toBeUndefined();
}
const askedOf = (r: string) =>
  JSON.parse(fs.readFileSync(path.join(r, ".tmp/repo/sessions/cu/git-asked.json"), "utf8"));

it("beforeSubmitPrompt prints nothing Cursor would reject and only records what git the user asked for", () => {
  const r = repo();
  // Cursor's event does one thing: git-asked.json. No /ask stamp, board line, approval or additionalContext.
  expect(cursor(r, "beforeSubmitPrompt", { prompt: "/ask", attachments: [] })).toBeNull();
  expect(fs.existsSync(path.join(r, ".tmp/repo/orchestrator-logs"))).toBe(false);
  expect(fs.readdirSync(path.join(r, ".tmp/repo/sessions/cu"))).toStrictEqual(["git-asked.json"]);
  expect(askedOf(r)).toStrictEqual({ words: [] });
  expect(cursor(r, "beforeSubmitPrompt", { prompt: "please stash the main checkout", attachments: [] })).toBeNull();
  expect(askedOf(r)).toStrictEqual({ words: ["stash"] });
  expect(fs.existsSync(path.join(r, ".tmp/repo/orchestrator-logs"))).toBe(false);
});

it("stop prints nothing for a completed turn and decision:block only for the ask gate", () => {
  const r = repo();
  const done = { status: "completed", loop_count: 0, transcript_path: null };
  expect(cursor(r, "stop", done)).toBeNull();
  const stamp = path.join(r, ".tmp/repo/orchestrator-logs", `${SESSION_GATE_STAMP}-cu`);
  fs.mkdirSync(path.dirname(stamp), { recursive: true });
  fs.writeFileSync(stamp, "ask");
  expect(cursor(r, "stop", done)).toStrictEqual({ decision: "block", reason: ASK_STOP_REASON });
  expect(cursor(r, "stop", { ...done, last_assistant_message: "done. Continue?" })).toBeNull();
});

it("preToolUse Shell dump and Write redirect answer in the nested form", () => {
  const r = repo();
  const shell = must(cursor(r, "preToolUse", { tool_name: "Shell", tool_input: { command: "cat big.log", cwd: r } }));
  nested(shell);
  expect(shell.hookSpecificOutput.updatedInput.command).toMatch(/node_modules\/\.bin\/repo job --job exec --query /);
  const tool_input = { file_path: ".tmp/repo/note.md", content: VALID_TMP };
  const write = must(cursor(r, "preToolUse", { tool_name: "Write", tool_input }));
  nested(write);
  const saved = write.hookSpecificOutput.updatedInput.file_path;
  expect(path.dirname(saved)).toBe(path.join(r, ".tmp/repo"));
  expect(fs.existsSync(saved)).toBe(true);
});

/** A native deny's permission and the types of its two messages. */
const nativeDeny = (reply: HookOut | null) => [
  reply?.permission,
  typeof reply?.user_message,
  typeof reply?.agent_message,
];

it("preToolUse denies in Cursor's native shape and passes plain calls through", () => {
  const r = repo();
  const tool_input = { file_path: ".tmp/repo/plans/x.md", content: "not a plan" };
  const bad = cursor(r, "preToolUse", { tool_name: "Write", tool_input });
  expect(nativeDeny(bad)).toStrictEqual(["deny", "string", "string"]);
  expect(bad?.hookSpecificOutput).toBeUndefined();
  const lock = cursor(r, "preToolUse", { tool_name: "Shell", tool_input: { command: "cat bun.lock" } });
  expect(nativeDeny(lock)).toStrictEqual(["deny", "string", "string"]);
  expect(Object.keys(must(lock)).toSorted()).toStrictEqual(["agent_message", "permission", "user_message"]);
  expect(cursor(r, "preToolUse", { tool_name: "Read", tool_input: { file_path: "big.log" } })).toBeNull();
  expect(cursor(r, "preToolUse", { tool_name: "Shell", tool_input: { command: "git status" } })).toBeNull();
});
