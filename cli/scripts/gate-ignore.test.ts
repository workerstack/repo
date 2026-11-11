import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { useTmp } from "./__fixtures__/gate-workspace.ts";
import { agyCall, asChild, claudeCall, codexCall, inSession } from "./__fixtures__/hook-payload.ts";
import { processHookPayload } from "./gate-fat-tools.ts";
import type { HookOutput } from "./gate-harness.ts";

const tmp = useTmp();
type Input = Record<string, unknown>;
const addC = { new_string: "dist-local/\n.tmp/\n", old_string: "dist-local/\n" };
const APPEND_A = "cat <<'EOF' >> packages/a/.gitignore\n.tmp/\nEOF";
const PATCH_ADD_A = "*** Begin Patch\n*** Add File: packages/a/.gitignore\n+.tmp/\n*** End Patch\n";
const PATCH_UPDATE_C =
  "*** Begin Patch\n*** Update File: packages/c/.gitignore\n@@\n dist-local/\n+.tmp/\n*** End Patch\n";

function repo() {
  const r = tmp.repo("gate-ignore-");
  fs.writeFileSync(path.join(r, ".gitignore"), ".tmp/\n*.log\n");
  fs.mkdirSync(path.join(r, "packages/c"), { recursive: true });
  fs.mkdirSync(path.join(r, "packages/a"), { recursive: true });
  fs.writeFileSync(path.join(r, "packages/c/.gitignore"), "dist-local/\n");
  return r;
}

function claudeSent(r: string, tool: string, input: Input) {
  return inSession(claudeCall(r, tool, input), "ig");
}
function claude(r: string, tool: string, input: Input) {
  return processHookPayload(claudeSent(r, tool, input));
}
function codex(r: string, tool: string, input: Input) {
  return processHookPayload(inSession(codexCall(r, tool, input), "ig"));
}
function antigravity(r: string, name: string, args: Input) {
  return processHookPayload(inSession(agyCall(r, name, args), "ig"));
}
function hookDeny(out: HookOutput | null) {
  return out?.hookSpecificOutput?.permissionDecision === "deny"
    ? (out.hookSpecificOutput.permissionDecisionReason ?? "")
    : "";
}
function decisionDeny(out: HookOutput | null) {
  return out?.decision === "deny" ? (out.reason ?? "") : "";
}

it("denies a redundant nested line in every harness's shape, naming the parent rule", () => {
  const r = repo();
  const rule = `${path.join(r, ".gitignore")}:1 .tmp/`;
  const a = path.join(r, "packages/a/.gitignore");
  const c = path.join(r, "packages/c/.gitignore");
  const hook = [
    claude(r, "Write", { content: ".tmp/\n", file_path: a }),
    claude(r, "Edit", { file_path: c, ...addC }),
    claude(r, "Bash", { command: APPEND_A }),
    processHookPayload(asChild(claudeSent(r, "Bash", { command: APPEND_A }), "scout")),
    codex(r, "apply_patch", { command: PATCH_ADD_A }),
    codex(r, "Bash", { command: `apply_patch <<'EOF'\n${PATCH_UPDATE_C}EOF\n` }),
  ];
  for (const [i, out] of hook.entries()) expect(hookDeny(out), String(i)).toContain(rule);
  const decision = [
    antigravity(r, "write_file", { Content: ".tmp/\n", Path: a }),
    antigravity(r, "edit_file", { Path: c, Replacement: "dist-local/\n.tmp/\n", Target: "dist-local/\n" }),
    antigravity(r, "run_command", { CommandLine: "echo .tmp/ > .gitignore", Cwd: path.join(r, "packages/a") }),
  ];
  for (const [i, out] of decision.entries()) expect(decisionDeny(out), String(i)).toContain(rule);
  expect(fs.existsSync(a)).toBe(false);
  expect(fs.readFileSync(c, "utf8")).toBe("dist-local/\n");
});

it("passes lines the parents miss, the root file, globs and other shell forms", () => {
  const r = repo();
  const outs = [
    claude(r, "Write", { content: "dist-local/\n", file_path: path.join(r, "packages/a/.gitignore") }),
    claude(r, "Write", { content: ".tmp/\n*.log\n.tmp/\n", file_path: path.join(r, ".gitignore") }),
    claude(r, "Write", { content: "*.log\n", file_path: path.join(r, "packages/a/.gitignore") }),
    claude(r, "Bash", { command: "cd packages/a && echo .tmp/ >> .gitignore" }),
  ];
  for (const [i, out] of outs.entries())
    expect(JSON.stringify(out ?? null), String(i)).not.toMatch(/redundant \.gitignore/);

  expect(fs.existsSync(path.join(r, "packages/a/.gitignore"))).toBe(false);
});
