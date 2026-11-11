/** The assistant's last reply, from the payload or the transcript's tail, and what its lines ask. */
import fs from "node:fs";
import { isRecord, type HookInput } from "./hook-input.ts";
import {
  ASSISTANT,
  LAST_INDEX,
  NON_ASSISTANT_TYPES,
  TOOL_PARTS,
  TRANSCRIPT_TAIL_BYTES,
  WAIT_SCOUT,
} from "./orchestrate.constants.ts";
import type { Approvable } from "./orchestrate.types.ts";
import { parseClosingLine } from "./strategy.ts";

const LEAD = /^[\s`*_>]+/;

/** The non-empty lines of a reply, each without its leading quote, list or emphasis marks. */
const strippedLines = (msg: unknown): string[] =>
  String(msg || "")
    .split("\n")
    .map((l) => l.replace(LEAD, "").replace(/[\s`*_]+$/, ""))
    .filter(Boolean);

/** The items the reply's last line asks to approve; null when it is no closing line. */
export function closingLineOf(msg: unknown): Approvable[] | null {
  return parseClosingLine(strippedLines(msg).at(LAST_INDEX) || "");
}

export function isWaitScoutExact(msg: unknown): boolean {
  const nonempty = String(msg || "")
    .split("\n")
    .filter((l) => l.trim());
  const [only = ""] = nonempty;
  return nonempty.length === 1 && only.replace(LEAD, "") === WAIT_SCOUT;
}

/** True when the reply asks the person something: a scout wait, a closing line or a question. */
export function hasStepAsk(msg: unknown): boolean {
  if (isWaitScoutExact(msg) || closingLineOf(msg)) return true;
  return String(msg || "")
    .split("\n")
    .map((l) => l.replace(LEAD, "").trim())
    .filter(Boolean)
    .some((l) => l.includes("?"));
}

export function firstNonEmptyStripped(msg: unknown): string {
  const first = String(msg || "")
    .split("\n")
    .find((line) => line.trim());
  return first === undefined ? "" : first.replace(LEAD, "");
}

export function endsWithQuestion(msg: string): boolean {
  const last = msg
    .split("\n")
    .map((l) => l.replace(/[\s`*_]+$/, ""))
    .filter(Boolean)
    .at(LAST_INDEX);
  return Boolean(last?.endsWith("?"));
}

export function payloadAssistantMessage(data: HookInput): string {
  return data.lastAssistantMessage || data.last_assistant_message || "";
}

function isAssistantRecord(obj: unknown): obj is Record<string, unknown> {
  if (!isRecord(obj)) return false;
  const type = String(obj.type || "").toLowerCase();
  if (NON_ASSISTANT_TYPES.has(type)) return false;
  if (type === ASSISTANT) return true;
  const role = String(obj.role || (isRecord(obj.message) && obj.message.role) || "").toLowerCase();
  return role === ASSISTANT;
}

/** The text parts of a content array, tool calls and results left out; null when none has text. */
function partsText(content: unknown[]): string | null {
  const texts: string[] = [];
  for (const part of content) {
    if (!isRecord(part) || TOOL_PARTS.has(String(part.type || ""))) continue;
    if (typeof part.text === "string" && part.text) texts.push(part.text);
  }
  const joined = texts.join("\n").trim();
  return joined ? joined : null;
}

function assistantTextFromRecord(obj: unknown): string | null {
  if (!isAssistantRecord(obj)) return null;
  const msg = isRecord(obj.message) ? obj.message : obj;
  const content = msg.content ?? obj.content;
  if (Array.isArray(content)) return partsText(content);
  if (typeof content === "string" && content.trim()) return content;
  if (typeof obj.text === "string" && obj.text.trim()) return obj.text;
  return null;
}

/** The transcript's last TRANSCRIPT_TAIL_BYTES as lines, a partial first line dropped. */
function tailLines(filePath: string): string[] {
  const st = fs.statSync(filePath);
  const start = Math.max(0, st.size - TRANSCRIPT_TAIL_BYTES);
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) lines.shift();
    return lines;
  } finally {
    fs.closeSync(fd);
  }
}

function parseRecord(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export function lastAssistantFromTranscript(filePath: string): string {
  try {
    if (!filePath) return "";
    let last = "";
    for (const line of tailLines(filePath)) {
      const t = line.trim();
      const extracted = t ? assistantTextFromRecord(parseRecord(t)) : null;
      if (extracted) last = extracted;
    }
    return last;
  } catch {
    return "";
  }
}
