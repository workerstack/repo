#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";

/**
 * Prints what each subagent spawn of a Claude Code session paid on its first turn: one row per spawn, with the model
 * it ran on, the first assistant message's input (input + cache creation + cache read tokens), and whether the
 * project `AGENTS.md` came in as an instructions attachment before that answer. Reads
 * `<session dir>/subagents/agent-*.meta.json` and the matching `agent-*.jsonl`.
 */
export type TokensIo = { log: (line: string) => void };

const USAGE = "usage: bun dev/agent-tokens.ts <session dir> [--match <description substring>]";
const HEADER = ["agent", "model", "first-turn", "agents.md", "description"];

type Row = { start: string; cells: string[] };

type Entry = {
  timestamp?: string;
  attachment?: { type?: string; files?: { path?: string }[] };
  message?: { role?: string; model?: string; usage?: Record<string, number> };
};

function readSpawn(subagents: string, metaFile: string): Row & { description: string } {
  const meta = JSON.parse(fs.readFileSync(path.join(subagents, metaFile), "utf8")) as { agentType?: string; description?: string };
  const transcript = path.join(subagents, metaFile.replace(/\.meta\.json$/, ".jsonl"));
  const entries = fs
    .readFileSync(transcript, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Entry);
  const answer = entries.findIndex((entry) => entry.message?.role === "assistant" && entry.message.usage !== undefined);
  const before = answer === -1 ? entries : entries.slice(0, answer);
  const agentsMd = before.some(
    (entry) =>
      entry.attachment?.type === "instructions" && (entry.attachment.files ?? []).some((file) => file.path?.endsWith("AGENTS.md") === true),
  );
  const message = answer === -1 ? undefined : entries[answer]!.message!;
  const usage = message?.usage ?? {};
  const tokens = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  const description = meta.description ?? "";
  return {
    start: entries[0]?.timestamp ?? "",
    description,
    cells: [meta.agentType ?? "-", message?.model ?? "-", answer === -1 ? "-" : String(tokens), agentsMd ? "yes" : "no", description],
  };
}

/** Prints the table through `io` and returns the exit code. */
export function runAgentTokens(args: string[], io: TokensIo): number {
  let session: string | undefined;
  let match = "";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--match") {
      const value = args[++i];
      if (value === undefined) {
        io.log(USAGE);
        return 1;
      }
      match = value;
    } else if (session === undefined) session = arg;
  }
  if (session === undefined) {
    io.log(USAGE);
    return 1;
  }
  const subagents = path.join(session, "subagents");
  if (!fs.existsSync(subagents)) {
    io.log(`no subagents dir: ${subagents}`);
    return 1;
  }
  const rows = fs
    .readdirSync(subagents)
    .filter((file) => file.endsWith(".meta.json"))
    .map((file) => readSpawn(subagents, file))
    .filter((row) => row.description.includes(match))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const table = [HEADER, ...rows.map((row) => row.cells)];
  const widths = HEADER.map((_, col) => Math.max(...table.map((cells) => cells[col]!.length)) + 2);
  for (const cells of table) io.log(cells.map((cell, col) => (col === cells.length - 1 ? cell : cell.padEnd(widths[col]!))).join(""));
  return 0;
}

if (import.meta.main) process.exit(runAgentTokens(process.argv.slice(2), { log: (line) => console.log(line) }));
