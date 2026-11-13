/** The one call to the Anthropic messages API, with fetch injected; the answer is parsed with zod at this edge. */
import { z } from "zod";

import { API_URL, API_VERSION } from "./client.constants.ts";
import type { Complete, Completion } from "./run.ts";

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export type ClientConfig = { apiKey: string; model: string; maxTokens: number; system: string };

function messageSchema() {
  const tokens = z.number().nullish();

  return z.object({
    content: z.array(z.object({ text: z.string().optional(), type: z.string() })),
    usage: z.object({
      cache_creation_input_tokens: tokens,
      cache_read_input_tokens: tokens,
      input_tokens: z.number(),
      output_tokens: z.number(),
    }),
  });
}

/** The API's own error message, or the raw body when it is not the API's error shape. */
function failure(status: number, body: string): Error {
  const errorSchema = z.object({ error: z.object({ message: z.string() }) });
  let message = body;

  try {
    const parsed = errorSchema.safeParse(JSON.parse(body));

    if (parsed.success) message = parsed.data.error.message;
  } catch {
    // not JSON: the raw body is the message
  }

  return new Error(`eval: API error ${status}: ${message}`);
}

/** The text of every text block and every input token billed, cached or not. */
function completionOf(body: string): Completion {
  const parsed = messageSchema().safeParse(JSON.parse(body));

  if (!parsed.success) throw new Error("eval: the API answer is not a message");
  const { content, usage } = parsed.data;
  const cached = (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);

  return {
    inputTokens: usage.input_tokens + cached,
    outputTokens: usage.output_tokens,
    text: content.map((block) => block.text ?? "").join(""),
  };
}

/** A `complete` that sends each input as the user message and reports the text and every token it was billed. */
export function createClient(fetchFn: FetchFn, config: ClientConfig): Complete {
  const headers = { "anthropic-version": API_VERSION, "content-type": "application/json", "x-api-key": config.apiKey };

  return async (input) => {
    const messages = [{ content: input, role: "user" }];
    const payload = { max_tokens: config.maxTokens, messages, model: config.model, system: config.system };
    const response = await fetchFn(API_URL, { body: JSON.stringify(payload), headers, method: "POST" });
    const body = await response.text();

    if (!response.ok) throw failure(response.status, body);

    return completionOf(body);
  };
}
