/** One jev request on the wire, and the short summary printed from its answers. */
import { isRecord } from "../json.ts";
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
import type { HeadersLike, JevFetch, JevResult, PostResult, StopKind } from "./jev.types.ts";

/** The request body's parts besides the model. */
type Ask = { questions: Record<string, unknown>; state: unknown };

export function fail(text: string): JevResult {
  return { code: FAIL_CODE, text };
}

export function headerGet(headers: HeadersLike | null | undefined, name: string): string | null {
  if (headers == null) return null;

  if ("get" in headers && typeof headers.get === "function") return headers.get(name);
  const plain: Record<string, string> = headers /* not a Headers object, so a plain map */ as Record<string, string>;

  return plain[name] ?? null;
}

export function parseState(stateText: string): unknown {
  const trimmed = stateText.trim();

  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return stateText;

  try {
    // Text that opens with { or [ parses to an object or array, never null.
    return JSON.parse(stateText);
  } catch {
    return stateText;
  }
}

/** One answer's summary line, or null for a kind the summary skips. */
function answerLine(id: string, answer: Record<string, unknown>): string | null {
  if (answer.type === CHOICE) return `- ${id} choice=${String(answer.choice)} confidence=${String(answer.confidence)}`;

  if (answer.type === NOUL) return `- ${id} noul=${String(answer.noul)}`;

  if (answer.type === SCORE) return `- ${id} score=${String(answer.score)} confidence=${String(answer.confidence)}`;

  return null;
}

export function formatAnswers(payload: Record<string, unknown>): string {
  const model = typeof payload.model === "string" && payload.model !== "" ? payload.model : MODEL;
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

  let json: unknown = null;

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
