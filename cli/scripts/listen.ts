#!/usr/bin/env bun
import { contextOf, VERBS } from "./listen-verbs.ts";
import { USAGE } from "./listen.constants.ts";
import type { ListenMainOpts } from "./listen.types.ts";
/** Speech-to-text (input only). Mic/file → local whisper.cpp or OpenAI Whisper. */
import { loadOptionalConsumerEnv } from "./load-optional-consumer-env.ts";

function errMessage(cause: unknown): string {
  const message = typeof cause === "object" && cause !== null && "message" in cause ? cause.message : undefined;

  if (typeof message === "string" && message !== "") return message;

  return String(cause).trim();
}

/** Runs one `repo listen` verb and returns its exit code; an unknown verb prints the usage. */
export async function main(argv: string[], opts: ListenMainOpts = {}): Promise<number> {
  if (opts.env === undefined) await loadOptionalConsumerEnv();
  const ctx = contextOf(argv, opts, (next) => main(next, opts));
  const handler = VERBS.get((ctx.rest[0] ?? "").toLowerCase());

  try {
    if (handler !== undefined) return await handler(ctx);
    ctx.log.error(USAGE);

    return 1;
  } catch (e) {
    ctx.log.error(errMessage(e));

    return 1;
  }
}
