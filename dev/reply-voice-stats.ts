#!/usr/bin/env bun
/** Count cold-reply tokens (arrows, key=value) in main-thread Claude replies, outside code. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ARROW_RE = /→|->|=>/g;
const KEY_VALUE_RE = /(?<![\w./-])[A-Za-z_][\w.-]*=[^\s=]+/g;

function prose(text: string) {
  return text.replace(/```[\s\S]*?(```|$)/g, " ").replace(/`[^`\n]*`/g, " ");
}

interface TranscriptRecord {
  type?: unknown;
  isSidechain?: unknown;
  timestamp?: unknown;
  message?: { content?: unknown } | null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** True for a JSON object whose `message`, when present, is an object or null. */
function isTranscriptRecord(v: unknown): v is TranscriptRecord {
  return isObject(v) && (v.message === undefined || v.message === null || isObject(v.message));
}

function replyText(record: TranscriptRecord): string {
  if (record.type !== "assistant" || record.isSidechain) return "";
  const content: unknown = record.message?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { text: string } => isObject(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

export function replyVoiceStats({ root, since }: { root: string; since: string }): {
  replies: number;
  coldReplies: number;
  arrows: number;
  keyValues: number;
} {
  const sinceMs = Date.parse(since);
  const stats = { replies: 0, coldReplies: 0, arrows: 0, keyValues: 0 };
  for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(root, dir.name);
    for (const name of fs.readdirSync(dirPath)) {
      const file = path.join(dirPath, name);
      if (!name.endsWith(".jsonl") || fs.statSync(file).mtimeMs < sinceMs) continue;
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          continue;
        }
        if (!isTranscriptRecord(value)) continue;
        const record = value;
        if (!(Date.parse(String(record.timestamp)) >= sinceMs)) continue;
        const text = replyText(record);
        if (!text.trim()) continue;
        const body = prose(text);
        const arrows = body.match(ARROW_RE)?.length ?? 0;
        const keyValues = body.match(KEY_VALUE_RE)?.length ?? 0;
        stats.replies += 1;
        stats.arrows += arrows;
        stats.keyValues += keyValues;
        if (arrows + keyValues > 0) stats.coldReplies += 1;
      }
    }
  }
  return stats;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (flag: string, fallback: string): string => {
    const i = process.argv.indexOf(flag);
    // a flag with no value yields undefined, as it always has
    return i >= 0 ? (process.argv[i + 1] as string) : fallback;
  };
  const root = arg("--root", path.join(os.homedir(), ".claude", "projects"));
  const since = arg("--since", "1970-01-01");
  process.stdout.write(JSON.stringify({ root, since, ...replyVoiceStats({ root, since }) }) + "\n");
}
