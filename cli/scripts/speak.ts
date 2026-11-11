#!/usr/bin/env bun
/** Text-to-speech (output only). Providers: elevenlabs, openai. */
import os from "node:os";

import { readEnv } from "../env.ts";
import { loadOptionalConsumerEnv } from "./doctor.ts";
import { errMessage, globalFetch, voices, whoami } from "./speak-api.ts";
import { loadCfg } from "./speak-config.ts";
import { say } from "./speak-say.ts";
import { USAGE, VERB_SAY, VERB_VOICES, VERB_WHOAMI } from "./speak.constants.ts";
import type { FetchFn, SpeakCfg, SpeakMainOpts, SpeakSpawn } from "./speak.types.ts";
import { parseArgv } from "./voice-args.ts";

type Ctx = {
  flags: Record<string, string>;
  cfg: SpeakCfg;
  cwd: string;
  fetchFn: FetchFn | undefined;
  spawn: SpeakSpawn | undefined;
};

/** The handler of `verb`, which returns the line to print; undefined for an unknown verb. */
function verbOf(verb: string): ((ctx: Ctx) => Promise<string>) | undefined {
  switch (verb) {
    case VERB_WHOAMI:
      return ({ flags, cfg, fetchFn }) => whoami({ cfg, fetchFn, provider: flags.provider });
    case VERB_VOICES:
      return ({ flags, cfg, fetchFn }) => voices({ cfg, fetchFn, provider: flags.provider });
    case VERB_SAY:
      return ({ flags, ...rest }) =>
        say({
          ...rest,
          out: flags.out,
          play: flags.play,
          provider: flags.provider,
          text: flags.text,
          voice: flags.voice,
        });
    default:
      return undefined;
  }
}

/** What a verb needs, from the injected options or the process. */
async function ctxOf(flags: Record<string, string>, opts: SpeakMainOpts): Promise<Ctx> {
  if (!opts.env) await loadOptionalConsumerEnv();
  const env = opts.env || readEnv();
  const home = opts.home || os.homedir();
  const cwd = opts.cwd || process.cwd();
  const fetchFn = opts.fetchFn ?? globalFetch();
  return { cfg: loadCfg({ env, home }), cwd, fetchFn, flags, spawn: opts.spawn };
}

export async function main(argv: string[], opts: SpeakMainOpts = {}): Promise<number> {
  const { _, flags } = parseArgv(argv);
  const ctx = await ctxOf(flags, opts);
  const log = opts.log || console;
  const run = verbOf(String(_[0] || "").toLowerCase());
  if (!run) {
    log.error(USAGE);
    return 1;
  }
  try {
    log.log(await run(ctx));
    return 0;
  } catch (e) {
    log.error(errMessage(e));
    return 1;
  }
}
