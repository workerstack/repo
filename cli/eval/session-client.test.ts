import { expect, it } from "vitest";

import type { ClaudeCall } from "./session-client.ts";
import { createSessionClient } from "./session-client.ts";

const CONFIG = { maxTokens: 64, model: "claude-haiku-5-5", system: "sys" };

/** A fake `claude` that records its calls and answers with `code` and `stdout`. */
function fake(code: number, stdout: string) {
  const calls: ClaudeCall[] = [];

  function runClaude(call: ClaudeCall) {
    calls.push(call);

    return Promise.resolve({ code, stdout });
  }

  return { calls, runClaude };
}

type Fields = { is_error?: boolean; result?: string; usage?: Record<string, number | null> };

function reply(fields: Fields): string {
  return JSON.stringify({ is_error: false, result: "yes", usage: { input_tokens: 1, output_tokens: 1 }, ...fields });
}

it("runs a bare, tool-less, session-less claude on the model, the system text and the input on stdin", async () => {
  const got = fake(0, reply({}));
  await createSessionClient(got.runClaude, CONFIG)("hello");

  expect(got.calls).toStrictEqual([
    {
      args: [
        "-p",
        "--model",
        "claude-haiku-5-5",
        "--tools",
        "",
        "--output-format",
        "json",
        "--no-session-persistence",
        "--strict-mcp-config",
        "--setting-sources",
        "",
        "--effort",
        "low",
      ],
      stdin: "hello",
      system: "sys",
    },
  ]);
});

it("answers the result text and counts input, cache creation and cache read tokens as input", async () => {
  const usage = { cache_creation_input_tokens: 10, cache_read_input_tokens: 100, input_tokens: 1, output_tokens: 7 };
  const got = fake(0, reply({ result: "ab", usage }));

  expect(await createSessionClient(got.runClaude, CONFIG)("x")).toStrictEqual({
    inputTokens: 111,
    outputTokens: 7,
    text: "ab",
  });
});

it("counts a null or missing cache field as zero", async () => {
  const usage = { cache_creation_input_tokens: null, input_tokens: 5, output_tokens: 2 };
  const got = fake(0, reply({ usage }));

  expect(await createSessionClient(got.runClaude, CONFIG)("x")).toStrictEqual({
    inputTokens: 5,
    outputTokens: 2,
    text: "yes",
  });
});

it("throws the result text when claude reports an error, even on exit 0", async () => {
  const got = fake(0, reply({ is_error: true, result: "Not logged in · Please run /login" }));

  await expect(createSessionClient(got.runClaude, CONFIG)("x")).rejects.toThrow(
    "eval: claude: Not logged in · Please run /login",
  );
});

it("throws the exit code when a failure is not JSON", async () => {
  const got = fake(3, "boom");

  await expect(createSessionClient(got.runClaude, CONFIG)("x")).rejects.toThrow("eval: claude: exit 3");
});

it("throws the exit code when a failing JSON is not a claude result", async () => {
  const got = fake(2, "{}");

  await expect(createSessionClient(got.runClaude, CONFIG)("x")).rejects.toThrow("eval: claude: exit 2");
});

it("throws when an exit 0 answer is not a claude result", async () => {
  const got = fake(0, "not json");

  await expect(createSessionClient(got.runClaude, CONFIG)("x")).rejects.toThrow(
    "eval: claude: the answer is not a result",
  );
});
