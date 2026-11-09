import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAgentTokens } from "./agent-tokens.ts";

const USAGE = "usage: bun dev/agent-tokens.ts <session dir> [--match <description substring>]";
const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

type Spawn = { id: string; agentType: string; description: string; entries: object[] };

const user = { type: "user", timestamp: "2026-01-01T00:00:00.000Z", message: { role: "user", content: "hi" } };
const instructions = (file: string) => ({
  type: "attachment",
  attachment: { type: "instructions", files: [{ path: file }] },
});
const assistant = (
  model: string,
  usage: { input: number; create: number; read: number },
  timestamp = "2026-01-01T00:00:01.000Z",
) => ({
  type: "assistant",
  timestamp,
  message: {
    role: "assistant",
    model,
    usage: {
      input_tokens: usage.input,
      cache_creation_input_tokens: usage.create,
      cache_read_input_tokens: usage.read,
      output_tokens: 4,
    },
  },
});

/** A session dir holding one meta and one transcript per spawn; returns the dir. */
function session(spawns: Spawn[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-agent-tokens-"));
  temps.push(dir);
  const subagents = path.join(dir, "subagents");
  fs.mkdirSync(subagents);
  for (const spawn of spawns) {
    fs.writeFileSync(
      path.join(subagents, `agent-${spawn.id}.meta.json`),
      JSON.stringify({ agentType: spawn.agentType, description: spawn.description }),
    );
    fs.writeFileSync(
      path.join(subagents, `agent-${spawn.id}.jsonl`),
      spawn.entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    );
  }
  return dir;
}

function run(args: string[]) {
  const lines: string[] = [];
  const code = runAgentTokens(args, { log: (line) => lines.push(line) });
  return { code, lines };
}

const SPAWNS: Spawn[] = [
  {
    id: "a1",
    agentType: "scout",
    description: "Other scout",
    entries: [user, assistant("claude-haiku-5-5", { input: 1, create: 2, read: 3 }, "2026-01-01T00:00:00.500Z")],
  },
  {
    id: "a2",
    agentType: "implementer-fast",
    description: "After implementer-fast",
    entries: [
      { ...user, timestamp: "2026-01-01T00:00:01.000Z" },
      instructions("/repo/AGENTS.md"),
      assistant("claude-sonnet-5-5", { input: 2, create: 6000, read: 0 }),
    ],
  },
  {
    id: "a3",
    agentType: "implementer-fast",
    description: "After implementer-fast again",
    entries: [
      { ...user, timestamp: "2026-01-01T00:00:02.000Z" },
      instructions("/repo/CLAUDE.md"),
      assistant("claude-sonnet-5-5", { input: 3, create: 100, read: 5000 }, "2026-01-01T00:00:03.000Z"),
      assistant("claude-sonnet-5-5", { input: 9, create: 9, read: 9 }, "2026-01-01T00:00:04.000Z"),
    ],
  },
];

describe("runAgentTokens", () => {
  it("prints one row per spawn with model, first-turn input and whether AGENTS.md came in", () => {
    const { code, lines } = run([session(SPAWNS), "--match", "After"]);
    expect(code).toBe(0);
    expect(lines).toEqual([
      "agent             model              first-turn  agents.md  description",
      "implementer-fast  claude-sonnet-5-5  6002        yes        After implementer-fast",
      "implementer-fast  claude-sonnet-5-5  5103        no         After implementer-fast again",
    ]);
  });

  it("without --match lists every spawn, in the order they started", () => {
    const { lines } = run([session([...SPAWNS].reverse())]);
    expect(lines.slice(1).map((line) => line.split(/\s{2,}/)[0] + "|" + line.split(/\s{2,}/).at(-1))).toEqual([
      "scout|Other scout",
      "implementer-fast|After implementer-fast",
      "implementer-fast|After implementer-fast again",
    ]);
  });

  it("only counts an AGENTS.md that came in before the first answer", () => {
    const dir = session([
      {
        id: "b1",
        agentType: "scout",
        description: "late",
        entries: [user, assistant("m", { input: 1, create: 1, read: 1 }), instructions("/repo/AGENTS.md")],
      },
    ]);
    expect(run([dir]).lines[1]).toMatch(/\sno\s/);
  });

  it("shows a dash for a spawn that never answered", () => {
    const dir = session([
      { id: "c1", agentType: "scout", description: "silent", entries: [user, { type: "attachment" }] },
    ]);
    expect(run([dir]).lines).toEqual([
      "agent  model  first-turn  agents.md  description",
      "scout  -      -           no         silent",
    ]);
  });

  it("prints usage and exits 1 without a session dir", () => {
    expect(run([])).toEqual({ code: 1, lines: [USAGE] });
    expect(run(["--match", "x"])).toEqual({ code: 1, lines: [USAGE] });
  });

  it("says so and exits 1 when the session has no subagents dir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-agent-tokens-"));
    temps.push(dir);
    expect(run([dir])).toEqual({ code: 1, lines: [`no subagents dir: ${path.join(dir, "subagents")}`] });
  });

  it("exits 1 when --match has no value", () => {
    expect(run([session(SPAWNS), "--match"])).toEqual({ code: 1, lines: [USAGE] });
  });
});
