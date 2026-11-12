#!/usr/bin/env bun
/** Handheld machine setup for optional repo integrations. Secrets stay in ~/.workerstack/. */
import os from "node:os";

import { enabledSkills } from "../config.ts";
import { repoEnv, type Env } from "../repo-env.ts";
import { firstNonEmpty } from "./first-non-empty.ts";
import { isInteractive as ttyInteractive } from "./is-interactive.ts";
import { flagOn, normalizeTarget, parseArgv } from "./setup-argv.ts";
import { setupBrowser } from "./setup-browser.ts";
import { setupGoogleWorkspace } from "./setup-google-workspace.ts";
import { defaultIo, errLine, logLine } from "./setup-io.ts";
import { setupJev } from "./setup-jev.ts";
import { setupListen } from "./setup-listen.ts";
import { firstMissing, formatStatus, menuOptions } from "./setup-menu.ts";
import { setupSpeak } from "./setup-speak.ts";
import { setupTargets, targetStatuses } from "./setup-status.ts";
import { USAGE } from "./setup.constants.ts";
import type { Flags, SetupCtx, SetupIo, SetupMainOpts, Statuses } from "./setup.types.ts";

/** The context main resolved, with the targets this repo enables. */
type Run = {
  ctx: SetupCtx & { env: Env; home: string; interactive: boolean; io: SetupIo | null };
  targets: string[];
};

/** One target's setup step. */
type Runner = (ctx: SetupCtx) => Promise<unknown>;

const RUNNERS: Readonly<Record<string, Runner>> = {
  browser: setupBrowser,
  "google-workspace": setupGoogleWorkspace,
  jev: setupJev,
  listen: setupListen,
  speak: setupSpeak,
};

function errMessage(e: unknown): string {
  const m = typeof e === "object" && e !== null && "message" in e ? e.message : undefined;

  return typeof m === "string" && m !== "" ? m : String(e);
}

function interactiveOf(argv: string[], env: Env, opts: SetupMainOpts): boolean {
  if (opts.interactive !== undefined) return opts.interactive;

  return ttyInteractive({ argv, env, stdin: opts.stdin ?? process.stdin, stdout: opts.stdout ?? process.stdout });
}

function homeOf(opts: SetupMainOpts, env: Env): string {
  return firstNonEmpty(opts.home, env.HOME, env.USERPROFILE) ?? os.homedir();
}

async function prepare(argv: string[], flags: Flags, opts: SetupMainOpts): Promise<Run> {
  const env = opts.env ?? repoEnv.process;
  const home = homeOf(opts, env);
  const targets = setupTargets([...(await enabledSkills(firstNonEmpty(opts.cwd) ?? process.cwd()))]);
  const interactive = interactiveOf(argv, env, opts);
  const io = opts.io ?? (interactive ? await defaultIo() : null);

  const ctx = {
    env,
    fetchFn: opts.fetchFn,
    flags,
    home,
    interactive,
    io,
    loginFn: opts.loginFn,
    openUrlFn: opts.openUrlFn,
    pathEnv: firstNonEmpty(opts.pathEnv, env.PATH, repoEnv.process.PATH),
    platform: opts.platform ?? process.platform,
    spawnSyncFn: opts.spawnSyncFn,
    whichFn: opts.whichFn,
  };

  return { ctx, targets };
}

function statusesOf({ ctx, targets }: Run): Promise<Statuses> {
  const { env, home, pathEnv, platform, whichFn } = ctx;

  return targetStatuses({ env, home, pathEnv, platform, targets, whichFn });
}

/** The target from argv or the terminal menu; "" after printing why there is none. */
async function pickTarget({ ctx, targets }: Run, raw: unknown, statuses: Statuses): Promise<string> {
  const { io } = ctx;
  let target = normalizeTarget(raw);

  if (target !== "" && !targets.includes(target)) {
    errLine(io, `${target} is off. Add it to agents.skills in workerstack.config.ts, then run \`bun repo sync\`.`);

    return "";
  }

  if (target === "" && ctx.interactive && typeof io?.select === "function") {
    const options = menuOptions(statuses, targets);
    target = normalizeTarget(
      await io.select({ initialValue: firstMissing(statuses, targets), message: "Setup", options }),
    );
  }

  if (target === "") errLine(io, USAGE.trimEnd());

  return target;
}

/** True when the target is already ok and the user declines to redo it; prints the skip and the statuses. */
async function keepsOk({ ctx, targets }: Run, target: string, statuses: Statuses): Promise<boolean> {
  const st = statuses[target];
  const { io } = ctx;

  if (st?.ok !== true || !ctx.interactive || flagOn(ctx.flags, "redo")) return false;

  if (typeof io?.confirm !== "function") return false;
  const again = await io.confirm({ initialValue: false, message: `${target} already ok (${st.extra}). Redo?` });

  if (again) return false;
  logLine(io, `skip ${target} (already ok)`);
  logLine(io, formatStatus(statuses, targets));

  return true;
}

export async function main(argv: string[], opts: SetupMainOpts = {}): Promise<number> {
  const { _, flags } = parseArgv(argv);
  const run = await prepare(argv, flags, opts);
  const statuses = await statusesOf(run);
  const target = await pickTarget(run, _[0], statuses);

  if (target === "") return 1;
  const { io } = run.ctx;

  try {
    if (await keepsOk(run, target, statuses)) return 0;
    const runner = RUNNERS[target] /* normalizeTarget returns only TARGETS, and RUNNERS has each */ as Runner;
    await runner(run.ctx);
    logLine(io, formatStatus(await statusesOf(run), run.targets));

    return 0;
  } catch (e) {
    errLine(io, errMessage(e));

    return 1;
  }
}
