import { expect, it } from "vitest";

import { createClient } from "./client.ts";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const CONFIG = { apiKey: "k", maxTokens: 64, model: "claude-haiku-5-5", system: "sys" };

/** A fetch that records its calls and answers with `status` and `body`. */
function answer(status: number, body: Json) {
  const calls: { url: string; init: RequestInit; body: string }[] = [];

  async function fetchFn(url: string, init: RequestInit): Promise<Response> {
    calls.push({ body: await new Response(init.body).text(), init, url });

    return new Response(JSON.stringify(body), { status });
  }

  return { calls, fetchFn };
}

function html(): Promise<Response> {
  return Promise.resolve(new Response("<html>", { status: 502 }));
}

it("posts the messages request with the key and version headers", async () => {
  const got = answer(200, { content: [], usage: { input_tokens: 1, output_tokens: 1 } });
  await createClient(got.fetchFn, CONFIG)("hello");
  const [call] = got.calls;

  expect(call?.url).toBe("https://api.anthropic.com/v1/messages");
  expect(call?.init.method).toBe("POST");

  expect(call?.init.headers).toStrictEqual({
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
    "x-api-key": "k",
  });

  expect(JSON.parse(call?.body ?? "")).toStrictEqual({
    max_tokens: 64,
    messages: [{ content: "hello", role: "user" }],
    model: "claude-haiku-5-5",
    system: "sys",
  });
});

it("joins the text blocks and sums every input token field", async () => {
  const got = answer(200, {
    content: [{ text: "a", type: "text" }, { type: "thinking" }, { text: "b", type: "text" }],
    usage: { cache_creation_input_tokens: 10, cache_read_input_tokens: 100, input_tokens: 1, output_tokens: 7 },
  });

  expect(await createClient(got.fetchFn, CONFIG)("x")).toStrictEqual({ inputTokens: 111, outputTokens: 7, text: "ab" });
});

it("counts a null or missing cache field as zero", async () => {
  const got = answer(200, {
    content: [{ text: "a", type: "text" }],
    usage: { cache_creation_input_tokens: null, input_tokens: 5, output_tokens: 2 },
  });

  expect(await createClient(got.fetchFn, CONFIG)("x")).toStrictEqual({ inputTokens: 5, outputTokens: 2, text: "a" });
});

it("names the status and the API's message on an error", async () => {
  const got = answer(429, { error: { message: "rate limited", type: "rate_limit_error" }, type: "error" });

  await expect(createClient(got.fetchFn, CONFIG)("x")).rejects.toThrow("eval: API error 429: rate limited");
});

it("names the status when the error body is not the API's", async () => {
  await expect(createClient(html, CONFIG)("x")).rejects.toThrow("eval: API error 502: <html>");
});

it("names a 200 answer that is not a message", async () => {
  const got = answer(200, { nope: true });

  await expect(createClient(got.fetchFn, CONFIG)("x")).rejects.toThrow("eval: the API answer is not a message");
});

it("keeps the body when an error is JSON but not the API's", async () => {
  const got = answer(500, { nope: 1 });

  await expect(createClient(got.fetchFn, CONFIG)("x")).rejects.toThrow('eval: API error 500: {"nope":1}');
});
