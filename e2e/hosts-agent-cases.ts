/** The hosts suite's codex gate and SessionStart cases and claude's SessionStart cases. */
import { expect, it } from "vitest";

import { installedBin } from "../dev/test-paths.ts";
import type { GetSandbox } from "./get-sandbox.types";
import { claudePayload, codexBase, commands, expectClean, GATE, MAP, only, output, runHook } from "./hosts-kit";
import { isRecord } from "./json";
import type { Sandbox } from "./sandbox";
import { BROKEN_RUNTIME } from "./sandbox.constants";
import { tail } from "./tail";

/** Runs codex's gate, from the repo root, on a Bash `command`. */
function codexCall(sb: Sandbox, command: string) {
  const gate = only(commands(sb, ".codex/hooks.json", { ends: GATE, event: "PreToolUse" }), "codex gate");
  const payload = { ...codexBase(sb), tool_input: { command }, tool_name: "Bash", tool_use_id: "u1" };

  return runHook(sb, gate, { cwd: sb.repo, payload });
}

/** Codex's gate lets git through, rewrites a file dump and denies a read inside a dependency. */
export function codexGateCases(get: GetSandbox) {
  it("lets a git command through", async () => {
    const r = await codexCall(get(), "git status");
    expect(r.out, tail(r.out)).not.toMatch(BROKEN_RUNTIME);
    expect(r.status, tail(r.out)).toBe(0);
    expect(r.stdout).not.toContain("deny");
  });

  it("rewrites a file dump through the installed bin", async () => {
    const sb = get();
    const r = await codexCall(sb, "cat src/index.ts");
    expect(r.status, tail(r.out)).toBe(0);
    const updated = output(r).updatedInput;
    expect(isRecord(updated) ? updated.command : null).toMatch(
      new RegExp(`^${installedBin(sb.repo).replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")} job --job exec --query `),
    );
  });

  it("denies a read inside a dependency", async () => {
    const r = await codexCall(get(), "cat node_modules/typescript/package.json");
    expect(r.out, tail(r.out)).not.toMatch(BROKEN_RUNTIME);
    expect(r.status === 2 || output(r).permissionDecision === "deny", tail(r.out)).toBe(true);
  });
}

/** Codex's SessionStart hook injects the folder map. */
export function codexSessionCase(get: GetSandbox) {
  it("SessionStart injects the folder map", async () => {
    const sb = get();

    const r = await runHook(
      sb,
      only(commands(sb, ".codex/hooks.json", { ends: MAP, event: "SessionStart" }), "codex session-map"),
      { cwd: sb.repo, payload: { ...codexBase(sb), hook_event_name: "SessionStart", source: "startup" } },
    );

    expectClean(sb, r);
    expect(output(r).hookEventName).toBe("SessionStart");
    expect(output(r).additionalContext).toContain("src/");
  });
}

/** Claude's SessionStart hook gives the folder map for every source. */
export function claudeSessionCases(get: GetSandbox) {
  it.each(["startup", "resume", "clear", "compact"])("SessionStart source %s gets the folder map", async (source) => {
    const sb = get();
    const pick = { ends: MAP, event: "SessionStart" };
    const command = only(commands(sb, ".claude/settings.json", pick), "claude session-map");

    const r = await runHook(sb, command, {
      env: { CLAUDE_PROJECT_DIR: sb.repo },
      payload: claudePayload(sb, { hook_event_name: "SessionStart", model: "claude-opus", source }),
    });

    expectClean(sb, r);
    expect(output(r).hookEventName).toBe("SessionStart");
    expect(output(r).additionalContext).toContain("src/");
    expect(output(r).additionalContext).not.toContain("this worktree has no install");
  });
}
