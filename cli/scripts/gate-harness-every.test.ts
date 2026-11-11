import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { aliasOf } from "../../dev/test-paths";
import { processFatTools, processHookPayload } from "./gate-fat-tools.ts";
import { rewritePatch, rewriteScratchWrite } from "./gate-rewrites.ts";
import { DENY_FILE_BYTES, REASON_DENYLIST, REASON_REREAD } from "./gate.constants.ts";
import { useTmp } from "./fixtures/gate-workspace.ts";
import {
  agyCall,
  asChild,
  claudeCall,
  codexCall,
  heredoc,
  inSession,
  patchAdd,
  patchUpdate,
} from "./fixtures/hook-payload.ts";

const tmp = useTmp();
const deniedPath = ["node", "modules/x/package.json"].join("_");
const JOB_QUERY = /node_modules\/\.bin\/repo job --job exec --query /;
const REL = ".tmp/repo/scratch/x.md";
const cx = (cwd: string, tool: string, command: string) => inSession(codexCall(cwd, tool, { command }), "cx1");
const codexAllow = (updatedInput: object) => ({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput },
});
const claudeDeny = (reason: string) => ({
  decision: "block",
  reason,
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
});

function repo() {
  const r = tmp.repo("gate-harness-");
  const a = path.join(r, "packages/a");
  fs.mkdirSync(a, { recursive: true });
  fs.writeFileSync(path.join(a, "big.log"), "x".repeat(DENY_FILE_BYTES + 1024));
  return { r, a, scratch: (rel: string) => path.join(r, ".tmp/repo", rel) };
}

it("Codex: redirects heredoc and freeform patches with allow, and leaves Update headers", () => {
  const { a, scratch } = repo();
  const moved = scratch("scratch/x.md");
  const viaShell = cx(a, "Bash", heredoc(patchAdd(REL)));
  expect(processHookPayload(viaShell)).toStrictEqual(codexAllow({ command: heredoc(patchAdd(moved)) }));
  const viaTool = processHookPayload(cx(a, "apply_patch", patchAdd(REL)));
  expect(viaTool).toStrictEqual(codexAllow({ command: patchAdd(moved) }));
  expect(processHookPayload(cx(a, "apply_patch", patchUpdate(".tmp/repo/scratch/u.md")))).toBeNull();
  expect(processHookPayload(asChild(viaShell, "scout"))).toStrictEqual(
    codexAllow({ command: heredoc(patchAdd(moved)) }),
  );
  expect(fs.existsSync(path.join(a, ".tmp"))).toBe(false);
  expect(fs.existsSync(scratch("scratch"))).toBe(false);
});

it("Codex: Bash rewrites carry allow and denies keep the Claude body", () => {
  const { a } = repo();
  const out = processHookPayload(cx(a, "Bash", "cat big.log"));
  expect(out?.hookSpecificOutput?.permissionDecision).toBe("allow");
  expect(out?.hookSpecificOutput?.updatedInput?.command).toMatch(JOB_QUERY);
  expect(processHookPayload(cx(a, "Bash", `cat ${deniedPath}`))).toStrictEqual(claudeDeny(REASON_DENYLIST));
});

it("Codex: every patched path counts as written for the re-read deny", () => {
  const { r, a } = repo();
  fs.writeFileSync(path.join(a, "small.md"), "x\n");
  const patch = "*** Begin Patch\n*** Update File: small.md\n@@\n-x\n+y\n*** Add File: notes/n.md\n+n\n*** End Patch";
  processHookPayload(cx(a, "apply_patch", patch));
  const read = (file: string, limit?: number) =>
    processFatTools(inSession(claudeCall(a, "Read", limit ? { file_path: file, limit } : { file_path: file }), "cx1"));
  for (const file of [path.join(a, "small.md"), path.join(a, "notes/n.md")]) {
    expect(read(file, 10), file).not.toStrictEqual({ type: "deny", reason: REASON_REREAD });
    expect(read(file), file).toStrictEqual({ type: "deny", reason: REASON_REREAD });
  }
  expect(fs.existsSync(path.join(r, "notes"))).toBe(false);
});

it("counts a write made through an alias of the repo for the re-read deny in either spelling", () => {
  const { r } = repo();
  const alias = path.join(aliasOf(r), "packages/a");
  const patch = "*** Begin Patch\n*** Update File: small.md\n@@\n-x\n+y\n*** End Patch";
  for (const [sid, child] of [
    ["al1", null],
    ["al2", "scout"],
  ] as const) {
    fs.writeFileSync(path.join(r, "packages/a/small.md"), "x\n");
    const sent = inSession(codexCall(alias, "apply_patch", { command: patch }), sid);
    processHookPayload(child ? asChild(sent, child) : sent);
    for (const { cwd, file } of [
      { cwd: r, file: path.join(r, "packages/a/small.md") },
      { cwd: alias, file: path.join(alias, "small.md") },
      { cwd: alias, file: "small.md" },
    ]) {
      const whole = processFatTools(inSession(claudeCall(cwd, "Read", { file_path: file }), sid));
      expect(whole, `${sid} ${file}`).toStrictEqual({ type: "deny", reason: REASON_REREAD });
    }
  }
});

it("Antigravity: overwrites only the changed args, denies with decision, and skips its read tools", () => {
  const { r, a, scratch } = repo();
  const agy = (name: string, args: Record<string, unknown>) => processHookPayload(agyCall(r, name, args));
  const target = path.join(a, REL);
  expect(agy("write_file", { Path: target, Content: "hi" })).toStrictEqual({
    decision: "allow",
    overwrite: { Path: scratch("scratch/x.md") },
  });
  const run = agy("run_command", { CommandLine: "cat big.log", Cwd: a, WaitMsBeforeAsync: 0 });
  expect(run?.decision).toBe("allow");
  expect(Object.keys(run?.overwrite ?? {})).toStrictEqual(["CommandLine"]);
  expect(run?.overwrite?.CommandLine).toMatch(JOB_QUERY);
  const denied = agy("run_command", { CommandLine: `cat ${deniedPath}`, Cwd: a });
  expect(denied).toStrictEqual({ decision: "deny", reason: REASON_DENYLIST });
  expect(agy("read_file", { Path: path.join(a, "big.log"), StartLine: 1, EndLine: 10 })).toBeNull();
  expect(fs.existsSync(scratch("scratch"))).toBe(false);
});

it("redirects a nested plan through tools orchestrate-parent cannot see, and leaves Claude's to it", () => {
  const { r, a, scratch } = repo();
  const nested = path.join(a, ".tmp/repo/plans/p.md");
  const patched = processHookPayload(cx(a, "apply_patch", patchAdd(nested)));
  expect(patched).toStrictEqual(codexAllow({ command: patchAdd(scratch("plans/p.md")) }));
  const agy = processHookPayload(agyCall(r, "write_file", { Path: nested, Content: "x" }));
  expect(agy).toStrictEqual({ decision: "allow", overwrite: { Path: scratch("plans/p.md") } });
  const claude = claudeCall(a, "Write", { file_path: nested, content: "x" });
  expect(processHookPayload(inSession(claude, "cl1"))).toBeNull();
});

it("parses Windows patch headers and targets with path.win32", () => {
  const w = { root: "C:\\r", checkout: "C:\\r", cwd: "C:\\r\\packages\\a" };
  const nested = "C:\\r\\packages\\a\\.tmp\\repo\\scratch\\x.md";
  const dest = "C:\\r\\.tmp\\repo\\scratch\\x.md";
  expect(rewritePatch(patchAdd(nested), w, path.win32).patch).toBe(patchAdd(dest));
  expect(rewriteScratchWrite(nested, w, path.win32)).toBe(dest);
});
