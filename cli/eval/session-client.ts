/** The one call to `claude -p` on the logged-in session, with the process injected; zod parses its JSON here. */
import { z } from "zod";

import type { ClientConfig } from "./client.ts";
import type { Complete, Completion } from "./run.ts";

export type ClaudeCall = { args: string[]; system: string; stdin: string };

export type RunClaude = (call: ClaudeCall) => Promise<{ code: number; stdout: string }>;

export type SessionConfig = Omit<ClientConfig, "apiKey">;

function resultSchema() {
  const tokens = z.number().nullish();

  return z.object({
    is_error: z.boolean().optional(),
    result: z.string(),
    usage: z.object({
      cache_creation_input_tokens: tokens,
      cache_read_input_tokens: tokens,
      input_tokens: z.number(),
      output_tokens: z.number(),
    }),
  });
}

/** The flags that make one call plain: no tools, no saved session, no settings, no MCP, no thinking. */
function flagsOf(config: SessionConfig): string[] {
  const bare = ["--tools", "", "--output-format", "json", "--no-session-persistence", "--strict-mcp-config"];

  return ["-p", "--model", config.model, ...bare, "--setting-sources", "", "--effort", "low"];
}

function parseResult(stdout: string): z.infer<ReturnType<typeof resultSchema>> | undefined {
  try {
    const parsed = resultSchema().safeParse(JSON.parse(stdout));

    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** The result text and every input token billed, cached or not; a failure throws with claude's own words. */
function completionOf(code: number, stdout: string): Completion {
  const parsed = parseResult(stdout);

  if (parsed?.is_error === true) throw new Error(`eval: claude: ${parsed.result}`);

  if (code !== 0) throw new Error(`eval: claude: exit ${code}`);

  if (parsed === undefined) throw new Error("eval: claude: the answer is not a result");
  const { usage } = parsed;
  const cached = (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);

  return { inputTokens: usage.input_tokens + cached, outputTokens: usage.output_tokens, text: parsed.result };
}

/** A `complete` that sends each input to `claude -p` on stdin and reports the text and every token it was billed. */
export function createSessionClient(runClaude: RunClaude, config: SessionConfig): Complete {
  return async (input) => {
    const { code, stdout } = await runClaude({ args: flagsOf(config), stdin: input, system: config.system });

    return completionOf(code, stdout);
  };
}
