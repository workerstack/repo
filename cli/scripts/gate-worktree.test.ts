import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { aliasOf } from "../../dev/test-paths";
import { useTmp } from "./fixtures/gate-workspace.ts";
import { agyCall, asChild, claudeCall, codexCall, inSession } from "./fixtures/hook-payload.ts";
import { processHookPayload } from "./gate-fat-tools.ts";

const tmp = useTmp();
const REASON = /^worktrees live in .*[\\/]\.worktrees[\\/]<name> on branch wt\/<name>: run bun /;
const MANAGED = "git worktree add .worktrees/y -b wt/y";
function claude(cwd: string, command: string) {
  return inSession(claudeCall(cwd, "Bash", { command }), "w");
}
function hasReason(out: unknown) {
  return /worktrees live in/.test(JSON.stringify(out ?? null));
}

function repo() {
  const r = tmp.repo("gate-wt-");
  fs.mkdirSync(path.join(r, "packages/a"), { recursive: true });
  return r;
}

it("denies a worktree outside .worktrees in every harness's shell, scout subagents too", () => {
  const r = repo();
  const add = "git worktree add ../elsewhere";
  const parent = processHookPayload(claude(r, add));
  expect(parent?.hookSpecificOutput?.permissionDecisionReason).toMatch(REASON);
  const scout = processHookPayload(asChild(claude(r, add), "scout"));
  expect(scout?.hookSpecificOutput?.permissionDecisionReason).toMatch(REASON);
  const codex = processHookPayload(inSession(codexCall(r, "Bash", { command: add }), "w"));
  expect(codex?.hookSpecificOutput?.permissionDecision).toBe("deny");
  const cwd = path.join(r, "packages/a");
  const agy = processHookPayload(inSession(agyCall(r, "run_command", { CommandLine: add, Cwd: cwd }), "w"));
  expect(agy?.decision).toBe("deny");
  expect(agy?.reason).toMatch(REASON);
  expect(hasReason(processHookPayload(claude(r, MANAGED)))).toBe(false);
});

it("allows a managed worktree add typed from an alias of the repo, in every shape", () => {
  const r = repo();
  const alias = aliasOf(r);
  const aliasPath = path.join(alias, ".worktrees", "y").split(path.sep).join("/");
  const outs = [
    processHookPayload(claude(alias, MANAGED)),
    processHookPayload(asChild(claude(alias, MANAGED), "scout")),
    processHookPayload(inSession(agyCall(alias, "run_command", { CommandLine: MANAGED, Cwd: alias }), "w")),
    processHookPayload(claude(r, `git worktree add ${aliasPath} -b wt/y`)),
  ];
  for (const [i, out] of outs.entries()) expect(hasReason(out), String(i)).toBe(false);
});
