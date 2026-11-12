#!/usr/bin/env bun
/** Count cold-reply tokens (arrows, key=value) in main-thread Claude replies, outside code. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import { isRecord, tryJson } from "../cli/json.ts";
import { processIo } from "./process-io.ts";
import {
  ARGV_START,
  ARROW_RE,
  ASSISTANT,
  DEFAULT_ROOT_PARTS,
  DEFAULT_SINCE,
  FENCED_CODE_RE,
  INLINE_CODE_RE,
  KEY_VALUE_RE,
  ROOT_FLAG,
  ROOT_NEEDS_VALUE,
  SINCE_FLAG,
  TEXT_PART,
  TRANSCRIPT_SUFFIX,
} from "./reply-voice-stats.constants.ts";

export type Io = { out: (line: string) => void; err: (line: string) => void };

type Stats = { replies: number; coldReplies: number; arrows: number; keyValues: number };

function prose(text: string): string {
  return text.replace(FENCED_CODE_RE, " ").replace(INLINE_CODE_RE, " ");
}

function buildTranscriptRecordSchema() {
  const field = z.unknown().optional();

  return z.looseObject({
    isSidechain: field,
    message: z.looseObject({ content: field }).nullable().optional(),
    timestamp: field,
    type: field,
  });
}

/** A transcript line's record: a JSON object whose `message`, when present, is an object or null. */
const transcriptRecordSchema = /* @__PURE__ */ buildTranscriptRecordSchema();

type TranscriptRecord = z.output<typeof transcriptRecordSchema>;

function replyText(record: TranscriptRecord): string {
  if (record.type !== ASSISTANT || record.isSidechain === true) return "";
  const content: unknown = record.message?.content;

  if (!Array.isArray(content)) return "";

  return content
    .filter(
      (part): part is { text: string } => isRecord(part) && part.type === TEXT_PART && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

/** The transcript record a line holds, or undefined when it is not JSON or not a record. */
function parseRecord(line: string): TranscriptRecord | undefined {
  return tryJson(transcriptRecordSchema, line);
}

/** The text of a main-thread reply written at or after `sinceMs`; empty for any other line. */
function replyOf(line: string, sinceMs: number): string {
  const record = parseRecord(line);

  if (record === undefined || !(Date.parse(String(record.timestamp)) >= sinceMs)) return "";

  return replyText(record);
}

/** Every transcript file under a project dir of `root` modified at or after `sinceMs`. */
function transcriptFiles(root: string, sinceMs: number): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((dir) => dir.isDirectory())
    .flatMap((dir) => fs.readdirSync(path.join(root, dir.name)).map((name) => path.join(root, dir.name, name)))
    .filter((file) => file.endsWith(TRANSCRIPT_SUFFIX) && fs.statSync(file).mtimeMs >= sinceMs);
}

export function replyVoiceStats({ root, since }: { root: string; since: string }): Stats {
  const sinceMs = Date.parse(since);
  const stats: Stats = { arrows: 0, coldReplies: 0, keyValues: 0, replies: 0 };
  const lines = transcriptFiles(root, sinceMs).flatMap((file) => fs.readFileSync(file, "utf8").split("\n"));

  for (const text of lines.map((line) => replyOf(line, sinceMs))) {
    if (text.trim() === "") continue;
    const body = prose(text);
    const arrows = body.match(ARROW_RE)?.length ?? 0;
    const keyValues = body.match(KEY_VALUE_RE)?.length ?? 0;
    stats.replies += 1;
    stats.arrows += arrows;
    stats.keyValues += keyValues;

    if (arrows + keyValues > 0) stats.coldReplies += 1;
  }

  return stats;
}

/** The value after `flag`, `fallback` when the flag is absent, and undefined when it ends the arguments. */
function flagValue(argv: string[], flag: string, fallback: string): string | undefined {
  const at = argv.indexOf(flag);

  return at >= 0 ? argv[at + 1] : fallback;
}

/** Prints the stats of the transcripts under `--root` since `--since` as one JSON line; returns the exit code. */
export function run(argv: string[], io: Io): number {
  const root = flagValue(argv, ROOT_FLAG, path.join(os.homedir(), ...DEFAULT_ROOT_PARTS));
  const since = flagValue(argv, SINCE_FLAG, DEFAULT_SINCE);

  if (root === undefined) {
    io.err(ROOT_NEEDS_VALUE);

    return 1;
  }

  io.out(JSON.stringify({ root, since, ...replyVoiceStats({ root, since: since ?? "" }) }));

  return 0;
}

if (import.meta.main) process.exitCode = run(process.argv.slice(ARGV_START), processIo);
