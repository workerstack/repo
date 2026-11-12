/** One jev request on the wire, and the short summary printed from its answers. */
import { z } from "zod";

import { isRecord, isString, type Json, type JsonObject, tryJson } from "../json.ts";
import {
  CHOICE,
  ENDPOINT,
  FAIL_CODE,
  MAX_ANSWER_LINES,
  MAX_INPUT_TOKENS_PER_DAY,
  MAX_REQUESTS_PER_DAY,
  MODEL,
  NOUL,
  SCORE,
  TIMEOUT_MS,
} from "./jev.constants.ts";
import type { JevFetch, JevResult, PostResult, StopKind } from "./jev.types.ts";
import { jsonText } from "./json-text.ts";

/** The request body's parts besides the model. */
type Ask = { questions: JsonObject; state: unknown };

export function fail(text: string): JevResult {
  return { code: FAIL_CODE, text };
}

export function parseState(stateText: string): Json {
  const trimmed = stateText.trim();

  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return stateText;

  // Text that opens with { or [ parses to an object or array, never null; any JSON state is sent as it is.
  return tryJson(z.json(), stateText) ?? stateText;
}

/** One answer's summary line, or null for a kind the summary skips. */
function answerLine(id: string, answer: JsonObject): string | null {
  const confidence = jsonText(answer.confidence);

  if (answer.type === CHOICE) return `- ${id} choice=${jsonText(answer.choice)} confidence=${confidence}`;

  if (answer.type === NOUL) return `- ${id} noul=${jsonText(answer.noul)}`;

  if (answer.type === SCORE) return `- ${id} score=${jsonText(answer.score)} confidence=${confidence}`;

  return null;
}

export function formatAnswers(payload: JsonObject): string {
  const model = isString(payload.model) && payload.model !== "" ? payload.model : MODEL;
  const used = Number(isRecord(payload.usage) ? payload.usage.input_tokens : payload.usage);
  const lines = [`${model}. input_tokens=${Number.isFinite(used) ? used : 0}`];
  const answers = isRecord(payload.answers) ? payload.answers : {};

  for (const [id, answer] of Object.entries(answers)) {
    if (lines.length >= MAX_ANSWER_LINES) break;
    const line = isRecord(answer) ? answerLine(id, answer) : null;

    if (line !== null) lines.push(line);
  }

  return `${lines.join("\n")}\n`;
}

export async function postOnce(fetchImpl: JevFetch, key: string, { questions, state }: Ask): Promise<PostResult> {
  const response = await fetchImpl(ENDPOINT, {
    body: JSON.stringify({ model: MODEL, questions, state }),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  let json: Json = null;

  try {
    json = await response.json();
  } catch {
    json = null;
  }

  return { headers: response.headers, json, status: response.status };
}

export function stopText(kind: StopKind | "lock"): string {
  if (kind === "requests") return `daily request cap ${MAX_REQUESTS_PER_DAY}\n`;

  if (kind === "tokens") return `daily input token cap ${MAX_INPUT_TOKENS_PER_DAY}\n`;

  return "jev usage lock busy\n";
}
