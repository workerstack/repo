#!/usr/bin/env bun
/**
 * Session browser rail: nav|snap|click|fill|scroll|wait|hover|select|shot|pdf|stop|doctor|ensure. Lightpanda
 * default.
 */
import { childEnv } from "../env.ts";
import { errMessage, fail, ok } from "./browser-session.ts";
import { contextOf, VERBS } from "./browser-verbs.ts";
import { ERROR_PREFIX, HELP_VERBS, UNKNOWN_VERB, USAGE } from "./browser.constants.ts";
import type { BrowserResult, RunOpts } from "./browser.types.ts";

/** Runs one `repo browser` verb and returns what it prints and exits with. */
export async function runBrowser(argv: string[], opts: RunOpts = {}): Promise<BrowserResult> {
  const ctx = contextOf(opts);
  const verb = (argv[0] ?? "").toLowerCase();

  if (HELP_VERBS.has(verb)) return ok(USAGE);
  const handler = VERBS.get(verb);

  if (handler === undefined) return fail(UNKNOWN_VERB);

  try {
    return await handler(argv, ctx);
  } catch (err) {
    return fail(errMessage(err).replace(ERROR_PREFIX, ""));
  }
}

export async function main(argv: string[]): Promise<number> {
  const r = await runBrowser(argv, {
    cwd: process.cwd(),
    env: childEnv(),
    platform: process.platform,
  });

  if (r.stdout !== "") process.stdout.write(r.stdout);

  if (r.stderr !== "") process.stderr.write(r.stderr);

  return r.code;
}
