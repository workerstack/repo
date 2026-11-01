#!/usr/bin/env node
/** Count cold-reply tokens (arrows, key=value) in main-thread Claude replies, outside code. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ARROW_RE = /→|->|=>/g;
const KEY_VALUE_RE = /(?<![\w./-])[A-Za-z_][\w.-]*=[^\s=]+/g;

function prose(text) {
  return text.replace(/```[\s\S]*?(```|$)/g, " ").replace(/`[^`\n]*`/g, " ");
}

function replyText(record) {
  if (record.type !== "assistant" || record.isSidechain) return "";
  const content = record.message?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

export function replyVoiceStats({ root, since }) {
  const sinceMs = Date.parse(since);
  const stats = { replies: 0, coldReplies: 0, arrows: 0, keyValues: 0 };
  for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(root, dir.name);
    for (const name of fs.readdirSync(dirPath)) {
      const file = path.join(dirPath, name);
      if (!name.endsWith(".jsonl") || fs.statSync(file).mtimeMs < sinceMs) continue;
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        let record;
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }
        if (!(Date.parse(record.timestamp) >= sinceMs)) continue;
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
  const arg = (flag, fallback) => {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : fallback;
  };
  const root = arg("--root", path.join(os.homedir(), ".claude", "projects"));
  const since = arg("--since", "1970-01-01");
  process.stdout.write(JSON.stringify({ root, since, ...replyVoiceStats({ root, since }) }) + "\n");
}
