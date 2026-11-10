import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { processHookPayload } from "./gate-fat-tools.ts";
import type { HookOutput } from "./gate-harness.ts";
import { useTmp } from "./fixtures/gate-workspace.ts";
import { agyCall, asChild, claudeCall, codexCall, inSession } from "./fixtures/hook-payload.ts";

const tmp = useTmp();
type Input = Record<string, unknown>;
const addC = { old_string: "dist-local/\n", new_string: "dist-local/\n.tmp/\n" };
const appendA = "cat <<'EOF' >> packages/a/.gitignore\n.tmp/\nEOF";
const patchAddA = "*** Begin Patch\n*** Add File: packages/a/.gitignore\n+.tmp/\n*** End Patch\n";
const patchUpdateC =
  "*** Begin Patch\n*** Update File: packages/c/.gitignore\n@@\n dist-local/\n+.tmp/\n*** End Patch\n";

function repo() {
  const r = tmp.repo("gate-ignore-");
  fs.writeFileSync(path.join(r, ".gitignore"), ".tmp/\n*.log\n");
  fs.mkdirSync(path.join(r, "packages/c"), { recursive: true });
  fs.mkdirSync(path.join(r, "packages/a"), { recursive: true });
  fs.writeFileSync(path.join(r, "packages/c/.gitignore"), "dist-local/\n");
  return r;
}

const claudeSent = (r: string, tool: string, input: Input) => inSession(claudeCall(r, tool, input), "ig");
const claude = (r: string, tool: string, input: Input) => processHookPayload(claudeSent(r, tool, input));
const codex = (r: string, tool: string, input: Input) => processHookPayload(inSession(codexCall(r, tool, input), "ig"));
const antigravity = (r: string, name: string, args: Input) =>
  processHookPayload(inSession(agyCall(r, name, args), "ig"));
const hookDeny = (out: HookOutput | null) =>
  out?.hookSpecificOutput?.permissionDecision === "deny" ? (out.hookSpecificOutput.permissionDecisionReason ?? "") : "";
const decisionDeny = (out: HookOutput | null) => (out?.decision === "deny" ? (out.reason ?? "") : "");

it("denies a redundant nested line in every harness's shape, naming the parent rule", () => {
  const r = repo();
  const rule = `${path.join(r, ".gitignore")}:1 .tmp/`;
  const a = path.join(r, "packages/a/.gitignore");
  const c = path.join(r, "packages/c/.gitignore");
  const hook = [
    claude(r, "Write", { file_path: a, content: ".tmp/\n" }),
    claude(r, "Edit", { file_path: c, ...addC }),
    claude(r, "Bash", { command: appendA }),
    processHookPayload(asChild(claudeSent(r, "Bash", { command: appendA }), "scout")),
    codex(r, "apply_patch", { command: patchAddA }),
    codex(r, "Bash", { command: `apply_patch <<'EOF'\n${patchUpdateC}EOF\n` }),
  ];
  for (const [i, out] of hook.entries()) expect(hookDeny(out), String(i)).toContain(rule);
  const decision = [
    antigravity(r, "write_file", { Path: a, Content: ".tmp/\n" }),
    antigravity(r, "edit_file", { Path: c, Target: "dist-local/\n", Replacement: "dist-local/\n.tmp/\n" }),
    antigravity(r, "run_command", { CommandLine: "echo .tmp/ > .gitignore", Cwd: path.join(r, "packages/a") }),
  ];
  for (const [i, out] of decision.entries()) expect(decisionDeny(out), String(i)).toContain(rule);
  expect(fs.existsSync(a)).toBe(false);
  expect(fs.readFileSync(c, "utf8")).toBe("dist-local/\n");
});

it("passes lines the parents miss, the root file, globs and other shell forms", () => {
  const r = repo();
  const outs = [
    claude(r, "Write", { file_path: path.join(r, "packages/a/.gitignore"), content: "dist-local/\n" }),
    claude(r, "Write", { file_path: path.join(r, ".gitignore"), content: ".tmp/\n*.log\n.tmp/\n" }),
    claude(r, "Write", { file_path: path.join(r, "packages/a/.gitignore"), content: "*.log\n" }),
    claude(r, "Bash", { command: "cd packages/a && echo .tmp/ >> .gitignore" }),
  ];
  for (const [i, out] of outs.entries()) {
    expect(JSON.stringify(out ?? null), String(i)).not.toMatch(/redundant \.gitignore/);
  }
  expect(fs.existsSync(path.join(r, "packages/a/.gitignore"))).toBe(false);
});
