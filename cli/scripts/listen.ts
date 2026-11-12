#!/usr/bin/env bun
import { contextOf, VERBS } from "./listen-verbs.ts";
import { USAGE } from "./listen.constants.ts";
import type { ListenMainOpts } from "./listen.types.ts";
/** Speech-to-text (input only). Mic/file → local whisper.cpp or OpenAI Whisper. */
import { loadOptionalConsumerEnv } from "./load-optional-consumer-env.ts";

/** True for a thrown value that carries a text message. */
function hasMessage(cause: unknown): cause is { message: string } {
  return typeof cause === "object" && cause !== null && "message" in cause && typeof cause.message === "string";
}

function errMessage(cause: unknown): string {
  if (hasMessage(cause) && cause.message !== "") return cause.message;

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
