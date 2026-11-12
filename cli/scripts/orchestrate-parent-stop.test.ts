import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { claudeHook } from "./__fixtures__/claude-hook.ts";
import { plantFile } from "./__fixtures__/plant-file.ts";
import type { HookInput } from "./hook-input.ts";
import { main } from "./orchestrate-parent.ts";
import { ASK_STOP_REASON } from "./orchestrate.constants.ts";

const hook = claudeHook();

afterEach(() => {
  vi.restoreAllMocks();
});

function receipt(ws: string, sid: string) {
  return fs.readFileSync(path.join(ws, ".tmp/repo/sessions", sid, "receipt.txt"), "utf8").split("\n");
}

describe("a host that sends no stdin", () => {
  it("ends with exit 0 and no reply when the process stdin is at end", () => {
    vi.spyOn(fs, "readSync").mockReturnValue(0);
    expect(main()).toBe(0);
  });
});

function ask(ws: string, sid: string) {
  return plantFile(ws, `.tmp/repo/orchestrator-logs/session-gate-${sid}`, "ask");
}

describe("a Stop that is not the end of a turn", () => {
  it("passes while a stop hook is already active", () => {
    const ws = hook.temp();
    ask(ws, "a1");

    for (const flag of ["stopHookActive", "stop_hook_active"])
      expect(hook.stop(ws, "a1", { [flag]: true, last_assistant_message: "Done." }), flag).toBeNull();
  });

  it("passes when the host stopped for a reason other than end_turn", () => {
    const ws = hook.temp();
    ask(ws, "a2");
    expect(hook.stop(ws, "a2", { last_assistant_message: "Done.", reason: "max_tokens" })).toBeNull();
  });
});

describe("the ask-mode stop block", () => {
  it("blocks a turn that ends without a question", () => {
    const ws = hook.temp();
    ask(ws, "a3");
    expect(hook.stop(ws, "a3", { last_assistant_message: "Done." })).toStrictEqual({
      decision: "block",
      reason: ASK_STOP_REASON,
    });
  });

  it("stops blocking at the cap held in the legacy stamp", () => {
    const ws = hook.temp();
    ask(ws, "a5");
    plantFile(ws, ".tmp/orchestrator-logs/stop-block-a5", "3");
    expect(hook.stop(ws, "a5", { last_assistant_message: "Done." })).toBeNull();
  });

  it("counts from zero when the stop-block stamp holds no number", () => {
    const ws = hook.temp();
    ask(ws, "a4");
    plantFile(ws, ".tmp/repo/orchestrator-logs/stop-block-a4", "junk");
    expect(hook.stop(ws, "a4", { last_assistant_message: "Done." })?.decision).toBe("block");
    expect(fs.readFileSync(path.join(ws, ".tmp/repo/orchestrator-logs/stop-block-a4"), "utf8")).toBe("1");
  });
});

describe("a session receipt", () => {
  it("counts the non-empty lines of the wrote and read lists", () => {
    const ws = hook.temp();
    plantFile(ws, ".tmp/repo/sessions/r1/wrote.txt", "a.ts\n\n  \nb.ts\n");
    hook.stop(ws, "r1", { last_assistant_message: "All done." });
    expect(receipt(ws, "r1")).toStrictEqual(["All done.", "2 wrote, 0 read.", "session=.tmp/repo/sessions/r1/", ""]);
  });

  it("is not written when the session directory cannot be made", () => {
    const ws = hook.temp();
    const blocker = plantFile(ws, ".tmp/repo/sessions/r2", "a file, not a directory");
    expect(hook.stop(ws, "r2", { last_assistant_message: "Done." })).toBeNull();
    expect(fs.readFileSync(blocker, "utf8")).toBe("a file, not a directory");
  });
});

const BEFORE = JSON.stringify({ content: "before", role: "assistant" });

const badLines: [string, unknown, string][] = [
  ["a line that is not JSON", "not json{", "before"],
  ["a JSON line that is not an object", 42, "before"],
  ["a user record", { text: "u", type: "user" }, "before"],
  ["a record of role user", { content: "u", role: "user" }, "before"],
  ["a record of role human", { message: { content: "u", role: "human" } }, "before"],
  ["a tool result record", { text: "t", type: "tool_result" }, "before"],
  ["a record with no type or role", { text: "t" }, "before"],
  ["an assistant record with empty parts", { content: [], type: "assistant" }, "before"],
  ["an assistant record with blank content", { content: "  ", type: "assistant" }, "before"],
  ["an assistant record with no text at all", { role: "assistant" }, "before"],
  ["a role set on the message", { message: { content: "from message", role: "assistant" } }, "from message"],
  ["a text field", { role: "assistant", text: "from text" }, "from text"],
  [
    "parts, skipping tool parts and non-objects",
    { content: ["bare", { text: "no", type: "tool_use" }, { type: "text" }, { text: "kept" }], type: "assistant" },
    "kept",
  ],
];

describe("the last assistant message read from a transcript", () => {
  it.each(badLines)("reads %s", (_name, record, expected) => {
    const ws = hook.temp();
    const line = typeof record === "string" ? record : JSON.stringify(record);
    const file = plantFile(ws, "transcript.jsonl", `${BEFORE}\n${line}\n`);
    hook.stop(ws, "t1", { transcript_path: file });
    expect(receipt(ws, "t1")[0]).toBe(expected);
  });

  it("reads only the tail of a transcript larger than the tail window", () => {
    const ws = hook.temp();
    const filler = JSON.stringify({ content: "x".repeat(1000), role: "assistant" });
    const lines = Array.from({ length: 700 }, () => filler);

    const file = plantFile(
      ws,
      "transcript.jsonl",
      [...lines, JSON.stringify({ content: "last", role: "assistant" })].join("\n"),
    );

    hook.stop(ws, "t2", { transcriptPath: file });
    expect(receipt(ws, "t2")[0]).toBe("last");
  });

  it("is empty when the transcript is missing", () => {
    const ws = hook.temp();
    hook.stop(ws, "t3", { transcript_path: path.join(ws, "missing.jsonl") });
    expect(receipt(ws, "t3")).toStrictEqual(["0 wrote, 0 read.", "session=.tmp/repo/sessions/t3/", ""]);
  });
});

function need(extra: HookInput) {
  return {
    hook_event_name: "SubagentStop",
    session_id: "c1",
    subagent_type: "scout",
    ...extra,
  };
}

describe("a child agent stop", () => {
  it("answers a need sent in the snake_case field", () => {
    const ws = hook.temp();
    plantFile(ws, "hit.txt", "snake-case-token\n");
    const out = hook.send(ws, need({ last_assistant_message: 'need: [{"job":"search","query":"snake-case-token"}]' }));
    expect(out?.hookSpecificOutput.additionalContext).toContain("snake-case-token");
  });

  it("passes with no message, or while a stop hook is active", () => {
    const ws = hook.temp();
    expect(hook.send(ws, need({}))).toBeNull();
    const msg = 'need: [{"job":"search","query":"x"}]';
    expect(hook.send(ws, need({ last_assistant_message: msg, stop_hook_active: true }))).toBeNull();
    expect(hook.stop(ws, "c1", { lastAssistantMessage: msg, stopHookActive: true, subagentType: "scout" })).toBeNull();
  });
});

describe("a child agent stop that cannot be answered", () => {
  it("passes once the session has intercepted three needs", () => {
    const ws = hook.temp();
    plantFile(ws, "hit.txt", "capped-token\n");
    plantFile(ws, ".tmp/repo/orchestrator-logs/need-intercept-c1", "3");
    const msg = 'need: [{"job":"search","query":"capped-token"}]';
    expect(hook.send(ws, need({ last_assistant_message: msg }))).toBeNull();
  });

  it("passes a need the job cannot run", () => {
    const ws = hook.temp();
    const msg = 'need: [{"job":"search","query":"x","path":"f.txt\\u0000x"}]';
    expect(hook.send(ws, need({ last_assistant_message: msg }))).toBeNull();
  });

  it("passes a need whose cwd leaves the workspace", () => {
    const ws = hook.temp();
    const msg = 'need: [{"job":"search","query":"x","cwd":"../outside"}]';
    expect(hook.send(ws, need({ last_assistant_message: msg }))).toBeNull();
  });
});
