import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { must, orchestrateKit, parseJson, replyOf, type HookOut } from "./fixtures/orchestrate-kit.ts";
import { spawnHook } from "./fixtures/run-hook.ts";

const kit = orchestrateKit();
const childMsg = "```js\nconst x = 1;\n```\nwrite file src/x.ts";
const scout = (msg: string) => ({ lastAssistantMessage: msg, subagentType: "scout" });

it("answers a SubagentStop need through the real entry", () => {
  const ws = kit.temp();
  fs.writeFileSync(path.join(ws, "hit.txt"), "spawned-entry-token\n");
  const out = spawnHook(
    "orchestrate-parent",
    {
      hookEventName: "SubagentStop",
      ...scout('need: [{"job":"search","query":"spawned-entry-token"}]'),
      workspaceRoot: ws,
      sessionId: "spawned",
    },
    { env: { GROK_HOOK_EVENT: "subagent_stop", GROK_WORKSPACE_ROOT: ws, REPO_BOARD_HOME: kit.temp() } },
  );
  expect(out.status, out.stderr).toBe(0);
  const json = parseJson<HookOut>(out.stdout);
  expect(json.decision).toBe("block");
  expect(json.hookSpecificOutput.additionalContext).toContain("spawned-entry-token");
});

it("child Stop without need: still no-ops", () => {
  const result = kit.run(
    { hookEventName: "Stop", reason: "end_turn", ...scout(childMsg) },
    { GROK_HOOK_EVENT: "stop" },
  );
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("");
});

it("SubagentStop and Stop+subagentType with a search need: blocks and contains facts", () => {
  const ws = kit.temp();
  fs.writeFileSync(path.join(ws, "hit.txt"), "unique-intercept-token-xyz\n");
  const need = 'need: [{"job":"search","query":"unique-intercept-token-xyz"}]';
  for (const event of ["SubagentStop", "Stop"]) {
    const result = kit.grok({ sid: `i-${event}`, ws }, event, { reason: "end_turn", ...scout(need) });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 match.");
    const json = must(replyOf(result));
    expect(json.decision).toBe("block");
    expect(json.hookSpecificOutput.additionalContext).toContain("1 match.");
    expect(json.hookSpecificOutput.additionalContext).toContain("unique-intercept-token-xyz");
    expect(json.hookSpecificOutput.hookEventName).toBe(event);
  }
});

it("need path glob cwd not dropped", () => {
  const ws = kit.temp();
  for (const dir of ["keep", "skip"]) {
    fs.mkdirSync(path.join(ws, dir));
    fs.writeFileSync(path.join(ws, dir, "hit.txt"), "extra-token-zzz\n");
  }
  fs.writeFileSync(path.join(ws, "keep", "hit.md"), "extra-token-zzz\n");
  const result = kit.grok(
    { sid: "extras", ws },
    "SubagentStop",
    scout('need: [{"job":"search","query":"extra-token-zzz","path":"keep","glob":"*.txt","cwd":"."}]'),
  );
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("keep/hit.txt");
  expect(result.stdout).not.toContain("skip/hit.txt");
  expect(result.stdout).not.toContain("hit.md");
});

it("mixed web need: does not intercept", () => {
  const ws = kit.temp();
  const need = 'need: [{"job":"search","query":"x"},{"job":"web","query":"https://example.com"}]';
  const result = kit.grok({ sid: "mix", ws }, "SubagentStop", scout(need));
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("");
});

it("need ok vs fail; intercept FALLBACK", () => {
  const ws = kit.temp();
  fs.writeFileSync(path.join(ws, "hit.txt"), "ok-token-aaa\n");
  const ok = kit.grok({ sid: "tok", ws }, "SubagentStop", scout('need: [{"job":"search","query":"ok-token-aaa"}]'));
  expect(ok.stdout).toContain("1 match.");
  expect(() => JSON.parse(ok.stdout)).not.toThrow();
  const fail = kit.grok({ sid: "tfail", ws }, "SubagentStop", scout("not a need dump"));
  expect(fail.stdout).toBe("");
  const fallback = 'need: [{"job":"search","query":"foo node_modules"}]';
  expect(kit.grok({ sid: "tfb", ws }, "SubagentStop", scout(fallback)).stdout).toBe("");
});
