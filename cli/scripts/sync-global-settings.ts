#!/usr/bin/env bun
/**
 * Merge each manifest host payload (`agents/global-settings/*`) into its
 * dotfile under $HOME: claude, codex, grok, antigravity and cursor full-permission
 * keys. Payload keys win; unrelated dest keys survive. Applies by default;
 * `--dry-run` only reports, `--check` reports drift per host.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stringify as stringifyToml } from "smol-toml";

import { repoEnv } from "../repo-env.ts";
import { checkHint, checkHosts, checkLine, projectConfigError } from "./check-globals.ts";
import { deepMerge } from "./deep-merge.ts";
import { hostIdsOf, loadManifest, readDest, readPayload, resolveDest } from "./global-settings-files.ts";
import {
  ALL_HOSTS,
  APPLY,
  CHECK_FLAG,
  DRY_RUN,
  DRY_RUN_FLAG,
  HOST_FLAG,
  HOST_PREFIX,
  JSON_FORMAT,
  JSON_INDENT,
  OK_STATE,
  UNKNOWN_HOST,
} from "./sync-global-settings.constants.ts";
import type {
  JsonObject,
  ManifestHost,
  ParsedArgv,
  ReportRow,
  SettingsFormat,
  SyncOptions,
  SyncResult,
} from "./sync-global-settings.types.ts";

/** The flags read so far. */
type ArgState = { dryRun: boolean; check: boolean; host: string };

/** One flag read: the index of the last arg it used and the flags after it. */
type ArgStep = { at: number; state: ArgState };

/** What one host's sync needs: the roots, the dest home, the skip pattern and whether to write. */
type HostSync = { ws: string; consumer: string; home: string | undefined; skipRe: RegExp; apply: boolean };

/** The package root, two levels above `cli/scripts/`: where the stock manifest and payloads live. */
function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Prints `text` on stderr; exit code 1. */
function fail(text: string | undefined): number {
  process.stderr.write(`${text}\n`);

  return 1;
}

function hostStep(state: ArgState, value: unknown, at: number): ArgStep | string {
  return typeof value !== "string" || value === "" ? UNKNOWN_HOST : { at, state: { ...state, host: value } };
}

/** Reads the flag at `i`; the step, or the error text. */
function flagStep(args: unknown[], i: number, state: ArgState): ArgStep | string {
  const a = args[i];

  if (a === DRY_RUN_FLAG) return { at: i, state: { ...state, dryRun: true } };

  if (a === CHECK_FLAG) return { at: i, state: { ...state, check: true } };

  if (a === HOST_FLAG) return hostStep(state, args[i + 1], i + 1);

  if (typeof a === "string" && a.startsWith(HOST_PREFIX)) return hostStep(state, a.slice(HOST_PREFIX.length), i);

  return `unknown flag: ${String(a)}`;
}

export function parseArgv(argv: unknown): ParsedArgv {
  const args: unknown[] = Array.isArray(argv) ? argv : [];
  let state: ArgState = { check: false, dryRun: false, host: ALL_HOSTS };

  for (let i = 0; i < args.length; i++) {
    const step = flagStep(args, i, state);

    if (typeof step === "string") return { error: step, ok: false };
    ({ at: i, state } = step);
  }

  if (state.check && state.dryRun) return { error: "--check and --dry-run do not combine", ok: false };

  return { ...state, ok: true };
}

function stringifyDest(value: JsonObject, format: SettingsFormat): string {
  const body = format === JSON_FORMAT ? JSON.stringify(value, null, JSON_INDENT) : stringifyToml(value);

  return body.endsWith("\n") ? body : `${body}\n`;
}

function isSet(value: string | null | undefined): value is string {
  return value != null && value !== "";
}

/** The first root that is set and not empty, else the working dir. */
function rootOf(...roots: (string | undefined)[]): string {
  return roots.find(isSet) ?? process.cwd();
}

/** Merges one host's payload into its dest, writing it when applying; its report row. */
function syncHost(h: ManifestHost, s: HostSync): ReportRow {
  const source = readPayload(s.ws, h, s.consumer);
  const destAbs = resolveDest(s.home, h.dest);
  const merged = deepMerge(readDest(destAbs, h.format, h.dest), source, s.skipRe);

  if (s.apply) {
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    fs.writeFileSync(destAbs, stringifyDest(merged, h.format));
  }

  const action = s.apply ? APPLY : DRY_RUN;

  return { action, dest: h.dest, id: h.id, line: `${action} ${h.id} ${h.dest}` };
}

/**
 * Manifest and payloads come from `sourceRoot` (default `workspaceRoot`); a payload under `consumerRoot`'s
 * `.repo/global-settings/` (default `workspaceRoot`) replaces the stock one. Only `home` is written.
 */
export function syncGlobals(opts: SyncOptions = {}): SyncResult {
  const { workspaceRoot, home, apply = false, host = ALL_HOSTS } = opts;
  const report: ReportRow[] = [];

  try {
    const consumer = rootOf(opts.consumerRoot, workspaceRoot);
    const ws = rootOf(opts.sourceRoot, workspaceRoot);
    const manifest = loadManifest(ws);

    if (!hostIdsOf(manifest).has(host)) return { error: `unknown host: ${host}`, ok: false, report };
    const s: HostSync = { apply, consumer, home, skipRe: new RegExp(manifest.skipKeyPattern, "i"), ws };

    for (const h of manifest.hosts.filter((x) => host === ALL_HOSTS || x.id === host)) report.push(syncHost(h, s));

    return { ok: true, report };
  } catch (err) {
    return { error: errorText(err), ok: false, report };
  }
}

/** `--check`: one line of per-host status, the hint on drift, then any project config error. */
function runCheck(home: string, host: string): number {
  const cwd = process.cwd();
  let statuses: ReturnType<typeof checkHosts>;

  try {
    statuses = checkHosts({ consumerRoot: cwd, home, host, sourceRoot: packageRoot(), workspaceRoot: cwd });
  } catch (err) {
    return fail(errorText(err));
  }

  process.stdout.write(`${checkLine(statuses)}\n`);
  const hint = checkHint(statuses);

  if (isSet(hint)) process.stdout.write(`${hint}\n`);
  const projectError = projectConfigError(cwd, home);

  if (isSet(projectError)) process.stderr.write(`${projectError}\n`);
  const isDrift = statuses.some((st) => st.state !== OK_STATE);

  return isSet(hint) || isSet(projectError) || isDrift ? 1 : 0;
}

/** Apply or dry-run the sync; prints the report, then any error. */
function runSync(home: string, parsed: { dryRun: boolean; host: string }): number {
  const result = syncGlobals({
    apply: !parsed.dryRun,
    consumerRoot: process.cwd(),
    home,
    host: parsed.host,
    sourceRoot: packageRoot(),
    workspaceRoot: process.cwd(),
  });

  for (const row of result.report) process.stdout.write(`${row.line}\n`);

  return result.ok ? 0 : fail(result.error);
}

export function main(argv: string[]): number {
  try {
    const parsed = parseArgv(argv);

    if (!parsed.ok) return fail(parsed.error);
    const home = repoEnv.process.HOME;

    if (!isSet(home)) return fail("HOME required");

    return parsed.check ? runCheck(home, parsed.host) : runSync(home, parsed);
  } catch (err) {
    return fail(errorText(err));
  }
}
