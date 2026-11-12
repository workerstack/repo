/** The assistant's last reply, from the payload or the transcript's tail, and what its lines ask. */
import fs from "node:fs";

import { z } from "zod";

import { isRecord, isString, type Json, tryJson, type JsonObject } from "../json.ts";
import { parseClosingLine } from "./closing-line.ts";
import { firstNonEmpty } from "./first-non-empty.ts";
import type { HookInput } from "./hook-input.ts";
import {
  ASSISTANT,
  LAST_INDEX,
  NON_ASSISTANT_TYPES,
  TOOL_PARTS,
  TRANSCRIPT_TAIL_BYTES,
  WAIT_SCOUT,
} from "./orchestrate.constants.ts";
import type { Approvable } from "./orchestrate.types.ts";

const LEAD = /^[\s`*_>]+/;
const TRAIL = /[\s`*_]+$/;

/** A JSON field as text: the string itself, anything else empty. */
function textOf(value: Json | undefined): string {
  return isString(value) ? value : "";
}

/** The non-empty lines of a reply, each without its leading quote, list or emphasis marks. */
function strippedLines(msg: string): string[] {
  return msg
    .split("\n")
    .map((l) => l.replace(LEAD, "").replace(TRAIL, ""))
    .filter((l) => l !== "");
}

/** The items the reply's last line asks to approve; null when it is no closing line. */
export function closingLineOf(msg: string): Approvable[] | null {
  return parseClosingLine(strippedLines(msg).at(LAST_INDEX) ?? "");
}

export function isWaitScoutExact(msg: string): boolean {
  const nonempty = msg.split("\n").filter((l) => l.trim() !== "");
  const [only = ""] = nonempty;

  return nonempty.length === 1 && only.replace(LEAD, "") === WAIT_SCOUT;
}

/** True when the reply asks the person something: a scout wait, a closing line or a question. */
export function hasStepAsk(msg: string): boolean {
  if (isWaitScoutExact(msg) || closingLineOf(msg) !== null) return true;

  return msg
    .split("\n")
    .map((l) => l.replace(LEAD, "").trim())
    .some((l) => l.includes("?"));
}

export function firstNonEmptyStripped(msg: string): string {
  const first = msg.split("\n").find((line) => line.trim() !== "");

  return first === undefined ? "" : first.replace(LEAD, "");
}

export function endsWithQuestion(msg: string): boolean {
  const last = msg
    .split("\n")
    .map((l) => l.replace(TRAIL, ""))
    .filter((l) => l !== "")
    .at(LAST_INDEX);

  return last?.endsWith("?") === true;
}

export function payloadAssistantMessage(data: HookInput): string {
  return firstNonEmpty(data.lastAssistantMessage, data.last_assistant_message) ?? "";
}

function isAssistantRecord(obj: JsonObject): boolean {
  const type = textOf(obj.type).toLowerCase();

  if (NON_ASSISTANT_TYPES.has(type)) return false;

  if (type === ASSISTANT) return true;
  const own = textOf(obj.role);
  const role = own === "" ? textOf(isRecord(obj.message) ? obj.message.role : undefined) : own;

  return role.toLowerCase() === ASSISTANT;
}

/** The text parts of a content array, tool calls and results left out; null when none has text. */
function partsText(content: Json[]): string | null {
  const texts: string[] = [];

  for (const part of content) {
    if (!isRecord(part) || TOOL_PARTS.has(textOf(part.type))) continue;

    if (isString(part.text) && part.text !== "") texts.push(part.text);
  }

  const joined = texts.join("\n").trim();

  return joined === "" ? null : joined;
}

/** The assistant text of one transcript record; each harness nests it its own way, so the fields are narrowed here. */
function assistantTextFromRecord(obj: JsonObject | undefined): string | null {
  if (obj === undefined || !isAssistantRecord(obj)) return null;
  const msg = isRecord(obj.message) ? obj.message : obj;
  const content = msg.content ?? obj.content;

  if (Array.isArray(content)) return partsText(content);

  if (isString(content) && content.trim() !== "") return content;

  if (isString(obj.text) && obj.text.trim() !== "") return obj.text;

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

export function lastAssistantFromTranscript(filePath: string): string {
  try {
    if (filePath === "") return "";
    let last = "";

    for (const line of tailLines(filePath)) {
      const t = line.trim();
      const extracted = t === "" ? null : assistantTextFromRecord(tryJson(z.record(z.string(), z.json()), t));

      if (extracted !== null) last = extracted;
    }

    return last;
  } catch {
    return "";
  }
}
