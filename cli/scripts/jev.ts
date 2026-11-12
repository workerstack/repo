#!/usr/bin/env bun
/** One TypeSafe System One call for an external research decision. Caps are local. */
import fs from "node:fs";
import os from "node:os";

import { repoEnv } from "../repo-env.ts";
import { createJevRunner } from "./create-jev-runner.ts";
import { loadJevKey } from "./jev-key.ts";
import { fail } from "./jev-post.ts";
import { FAIL_CODE, FLAG_ON, FLAG_PREFIX, REQUEST_FAILED, USAGE } from "./jev.constants.ts";
import type { JevMainOpts, JevResult } from "./jev.types.ts";

/** The `--state` and `--questions` files' texts. */
type InputTexts = { stateText: string; questionsText: string };

export function parseArgv(argv: unknown): { flags: Record<string, string> } {
  const flags: Record<string, string> = {};
  const args: unknown[] = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (typeof arg !== "string" || !arg.startsWith(FLAG_PREFIX)) continue;
    const eq = arg.indexOf("=");
    if (eq > FLAG_PREFIX.length) {
      flags[arg.slice(FLAG_PREFIX.length, eq)] = arg.slice(eq + 1);
      continue;
    }
    const name = arg.slice(FLAG_PREFIX.length);
    const next = args[i + 1];
    if (Boolean(next) && !String(next).startsWith(FLAG_PREFIX)) {
      flags[name] = String(next);
      i += 1;
    } else {
      flags[name] = FLAG_ON;
    }
  }
  return { flags };
}

/** The process's one runner: every `runJev` without its own `run` shares it, so a process makes one request. */
const runner = /* @__PURE__ */ createJevRunner();

/** The two input files' texts, or the usage or missing-file failure. */
function readInputs(flags: Record<string, string>): InputTexts | JevResult {
  const { state = "", questions = "" } = flags;
  if (state === "" || questions === "") return fail(USAGE);
  try {
    return {
      questionsText: fs.readFileSync(questions, "utf8"),
      stateText: fs.readFileSync(state, "utf8"),
    };
  } catch {
    return fail("state or questions file missing\n");
  }
}

export function runJev(argv: string[], opts: JevMainOpts = {}): Promise<JevResult> {
  const { flags } = parseArgv(argv);
  if ((flags.available ?? "") !== "") {
    const home = opts.home === undefined || opts.home === "" ? os.homedir() : opts.home;
    const isPresent = loadJevKey({ env: opts.env ?? repoEnv.process, home }) !== "";
    return Promise.resolve({ code: 0, text: isPresent ? "yes\n" : "no\n" });
  }
  const texts = readInputs(flags);
  if ("code" in texts) return Promise.resolve(texts);
  const run = opts.run ?? runner;
  return run({
    env: opts.env,
    fetchImpl: opts.fetchImpl,
    home: opts.home,
    now: opts.now,
    questionsText: texts.questionsText,
    sleep: opts.sleep,
    stateText: texts.stateText,
  });
}

export async function main(argv: string[]): Promise<number> {
  try {
    const result = await runJev(argv);
    process.stdout.write(result.text);
    return result.code;
  } catch {
    process.stdout.write(REQUEST_FAILED);
    return FAIL_CODE;
  }
}
