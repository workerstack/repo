#!/usr/bin/env bun
import { isRecord } from "./hook-input.ts";
import { contextOf, VERBS } from "./listen-verbs.ts";
import { USAGE } from "./listen.constants.ts";
import type { ListenMainOpts } from "./listen.types.ts";
/** Speech-to-text (input only). Mic/file → local whisper.cpp or OpenAI Whisper. */
import { loadOptionalConsumerEnv } from "./load-optional-consumer-env.ts";

function errMessage(e: unknown): string {
  const m = isRecord(e) ? e.message : undefined;
  return String(m || e);
}

/** Runs one `repo listen` verb and returns its exit code; an unknown verb prints the usage. */
export async function main(argv: string[], opts: ListenMainOpts = {}): Promise<number> {
  if (!opts.env) await loadOptionalConsumerEnv();
  const ctx = contextOf(argv, opts, (next) => main(next, opts));
  const handler = VERBS.get(String(ctx.rest[0] || "").toLowerCase());
  try {
    if (handler) return await handler(ctx);
    ctx.log.error(USAGE);
    return 1;
  } catch (e) {
    ctx.log.error(errMessage(e));
    return 1;
  }
}
