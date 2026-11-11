#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  AGENTS_FILE,
  ARGV_START,
  ASSISTANT,
  COLUMN_GAP,
  HEADER,
  INSTRUCTIONS,
  MATCH_FLAG,
  META_SUFFIX,
  META_SUFFIX_PATTERN,
  NO,
  NOT_FOUND,
  NONE,
  SUBAGENTS_DIR,
  TRANSCRIPT_SUFFIX,
  USAGE,
  YES,
} from "./agent-tokens.constants.ts";

/**
 * Prints what each subagent spawn of a Claude Code session paid on its first turn: one row per spawn, with the model
 * it ran on, the first assistant message's input (input + cache creation + cache read tokens), and whether the
 * project `AGENTS.md` came in as an instructions attachment before that answer. Reads
 * `<session dir>/subagents/agent-*.meta.json` and the matching `agent-*.jsonl`.
 */
export type Io = { out: (line: string) => void; err: (line: string) => void };

/** A field of another tool's file that is not the expected type reads as absent, as the reader never rejected it. */
const lenient = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

const buildMetaSchema = () => z.object({ agentType: lenient(z.string()), description: lenient(z.string()) });
const buildEntrySchema = () =>
  z.object({
    timestamp: lenient(z.string()),
    attachment: lenient(
      z.object({
        type: lenient(z.string()),
        files: lenient(z.array(z.object({ path: lenient(z.string()) }))),
      }),
    ),
    message: lenient(
      z.object({
        role: lenient(z.string()),
        model: lenient(z.string()),
        usage: lenient(z.record(z.string(), z.number())),
      }),
    ),
  });
const metaSchema = /* @__PURE__ */ buildMetaSchema();
const entrySchema = /* @__PURE__ */ buildEntrySchema();
type Entry = z.infer<typeof entrySchema>;
type Row = { start: string; description: string; cells: string[] };

const readEntries = (transcript: string): Entry[] =>
  fs
    .readFileSync(transcript, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => entrySchema.parse(JSON.parse(line)));

const answersWithUsage = (entry: Entry): boolean =>
  entry.message?.role === ASSISTANT && entry.message.usage !== undefined;

const attachesAgentsMd = (entry: Entry): boolean =>
  entry.attachment?.type === INSTRUCTIONS &&
  (entry.attachment.files ?? []).some((file) => file.path?.endsWith(AGENTS_FILE) === true);

const firstTurnTokens = (usage: Record<string, number> = {}): number =>
  (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);

/** Whether the project `AGENTS.md` came in before the entry at `answer` (before the end when there is none). */
const agentsMdBefore = (entries: Entry[], answer: number): boolean =>
  (answer === NOT_FOUND ? entries : entries.slice(0, answer)).some(attachesAgentsMd);

/** The cells of a spawn's row: agent type, model, first-turn input, AGENTS.md and description. */
function spawnCells(meta: z.infer<typeof metaSchema>, entries: Entry[]): string[] {
  const answer = entries.findIndex(answersWithUsage);
  const first = entries[answer];
  const tokens = first === undefined ? NONE : String(firstTurnTokens(first.message?.usage));
  const agentsMd = agentsMdBefore(entries, answer) ? YES : NO;
  return [meta.agentType ?? NONE, first?.message?.model ?? NONE, tokens, agentsMd, meta.description ?? ""];
}

const spawnRow = (meta: z.infer<typeof metaSchema>, entries: Entry[]): Row => ({
  start: entries[0]?.timestamp ?? "",
  description: meta.description ?? "",
  cells: spawnCells(meta, entries),
});

function readSpawn(subagents: string, metaFile: string): Row {
  const meta = metaSchema.parse(JSON.parse(fs.readFileSync(path.join(subagents, metaFile), "utf8")));
  return spawnRow(meta, readEntries(path.join(subagents, metaFile.replace(META_SUFFIX_PATTERN, TRANSCRIPT_SUFFIX))));
}

/** The session dir and description filter of the arguments; undefined when the usage is wrong. */
function parseArgs(args: string[]): { session: string; match: string } | undefined {
  let session: string | undefined;
  let match = "";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === MATCH_FLAG) {
      const value = args[++i];
      if (value === undefined) return undefined;
      match = value;
    } else session ??= arg;
  }
  return session === undefined ? undefined : { session, match };
}

/** The table's lines: columns padded to their widest cell, the last one left as it is. */
function tableLines(rows: Row[]): string[] {
  const table = [HEADER, ...rows.map((row) => row.cells)];
  const widths = HEADER.map((_, col) => Math.max(...table.map((cells) => (cells[col] ?? "").length)) + COLUMN_GAP);
  return table.map((cells) =>
    cells.map((cell, col) => (col === cells.length - 1 ? cell : cell.padEnd(widths[col] ?? 0))).join(""),
  );
}

const byStart = (a: Row, b: Row): number => Number(a.start > b.start) - Number(a.start < b.start);

/** Prints the table through `io` and returns the exit code. */
export function run(argv: string[], io: Io): number {
  const args = parseArgs(argv);
  if (args === undefined) {
    io.out(USAGE);
    return 1;
  }
  const subagents = path.join(args.session, SUBAGENTS_DIR);
  if (!fs.existsSync(subagents)) {
    io.out(`no subagents dir: ${subagents}`);
    return 1;
  }
  const rows = fs
    .readdirSync(subagents)
    .filter((file) => file.endsWith(META_SUFFIX))
    .map((file) => readSpawn(subagents, file))
    .filter((row) => row.description.includes(args.match))
    .sort(byStart);
  for (const line of tableLines(rows)) io.out(line);
  return 0;
}

if (import.meta.main)
  process.exitCode = run(process.argv.slice(ARGV_START), {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  });
