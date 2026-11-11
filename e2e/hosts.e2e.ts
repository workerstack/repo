/**
 * What init.e2e.ts leaves out: each host's hooks driven the way that host calls them, hosts that only get files
 * generated, and a linked worktree with no install of its own (T3 Code makes these under `~/.t3/worktrees/`).
 * Every spawned process clears CLAUDE_PROJECT_DIR and GROK_WORKSPACE_ROOT unless the case sets one.
 */
import { beforeAll, describe, expect, it } from "vitest";

import type { GetSandbox } from "./get-sandbox.types";
import { claudeSessionCases, codexGateCases, codexSessionCase } from "./hosts-agent-cases";
import { claudePayload, codexBase, expectClean, runHook, stopCommands } from "./hosts-kit";
import { generatedHostCases, worktreeCases } from "./hosts-tree-cases";
import { PACKAGE_NAME } from "./registry";
import type { Run } from "./run.types";
import { Sandbox } from "./sandbox";
import { BROKEN_RUNTIME } from "./sandbox.constants";
import { tail } from "./tail";

/** Runs each of `file`'s Stop hooks in turn in the shared sandbox, with `hook`; none breaks the runtime or blocks. */
async function stopsPass(sb: Sandbox, file: string, hook: (command: string) => Promise<Run>): Promise<void> {
  for (const command of stopCommands(sb, file)) {
    const r = await hook(command);
    expect(r.out, tail(r.out)).not.toMatch(BROKEN_RUNTIME);
    expect([0, 2], tail(r.out)).toContain(r.status);
  }
}

/** Codex's Stop hooks each run, one after another, and none blocks. */
function codexStopCase(get: GetSandbox) {
  it("Stop runs every hook without blocking", async () => {
    const sb = get();
    expect(stopCommands(sb, ".codex/hooks.json").length).toBeGreaterThan(0);
    const payload = {
      ...codexBase(sb),
      hook_event_name: "Stop",
      last_assistant_message: "done",
      stop_hook_active: false,
    };
    await stopsPass(sb, ".codex/hooks.json", (command) => runHook(sb, command, { cwd: sb.repo, payload }));
  });
}

/** Claude's Stop hooks each run, one after another, and none blocks. */
function claudeStopCases(get: GetSandbox) {
  it.each([false, true])("Stop with stop_hook_active %s runs every hook without blocking", async (active) => {
    const sb = get();
    const env = { CLAUDE_PROJECT_DIR: sb.repo };
    const payload = claudePayload(sb, { hook_event_name: "Stop", stop_hook_active: active });
    const passed = stopsPass(sb, ".claude/settings.json", (command) => runHook(sb, command, { env, payload }));
    await expect(passed).resolves.toBeUndefined();
  });
}

describe("hosts", () => {
  let made: Sandbox | undefined;
  function get(): Sandbox {
    if (made === undefined) throw new Error("the hosts sandbox is made in beforeAll");
    return made;
  }

  beforeAll(async () => {
    const sb = new Sandbox("hosts");
    made = sb;
    await sb.scaffold();
    expectClean(sb, await sb.launch(PACKAGE_NAME, "init"));
  });

  describe("codex calls .codex/hooks.json with its cwd and nothing else", () => {
    codexGateCases(get);
    codexSessionCase(get);
    codexStopCase(get);
  });

  describe("claude payload shapes", () => {
    claudeSessionCases(get);
    claudeStopCases(get);
  });

  describe("hosts that only get files generated", () => {
    generatedHostCases(get);
  });

  describe("a linked worktree with no install", () => {
    worktreeCases(get);
  });
});
