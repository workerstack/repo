#!/usr/bin/env bun
/** Purge stubborn global MCP sources under $HOME (dry-run default). Never project MCP. */
import fs from "node:fs";
import path from "node:path";

import { stringify as stringifyToml } from "smol-toml";

import { APPLY_ACTION, DRY_RUN_ACTION, JSON_INDENT } from "./purge-global-mcps.constants.ts";
import type { GrokPlan, JsonPlan, PurgeResult, ReportRow } from "./purge-global-mcps.types.ts";
import { parseArgv, resolveHome } from "./purge-paths.ts";
import { planClaudePlugins, planCursor, planGrok } from "./purge-plans.ts";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function writeText(abs: string, body: string): void {
  const text = body.endsWith("\n") ? body : `${body}\n`;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function reportLine(row: { action: string; path: string; detail: string }): string {
  return `${row.action} ${row.path} ${row.detail}`;
}

function writeJson(plan: JsonPlan): void {
  if (!plan.skip && plan.json !== null) writeText(plan.abs, JSON.stringify(plan.json, null, JSON_INDENT));
}

/** Writes every changed dest, grok first; called only once all three planned cleanly. */
function writePlans(grok: GrokPlan, cursor: JsonPlan, claude: JsonPlan): void {
  if (!grok.skip && grok.obj !== null) writeText(grok.abs, stringifyToml(grok.obj));
  writeJson(cursor);
  writeJson(claude);
}

/** Plan the three global dests under `home`, write them when `apply`, and report one line per dest. */
export function purgeGlobalMcps({ home, apply = false }: { home?: string; apply?: boolean } = {}): PurgeResult {
  const report: ReportRow[] = [];
  const action = apply ? APPLY_ACTION : DRY_RUN_ACTION;
  try {
    if (home === undefined || home === "") throw new Error("HOME required");
    const grok = planGrok(home);
    const cursor = planCursor(home);
    const claude = planClaudePlugins(home);
    if (apply) writePlans(grok, cursor, claude);
    for (const plan of [grok, cursor, claude]) {
      const row = { action, detail: plan.detail, path: plan.abs };
      report.push({ ...row, line: reportLine(row) });
    }
    return { ok: true, report };
  } catch (err) {
    return { error: errorText(err), ok: false, report };
  }
}

/** `repo purge-mcps [--apply]`: the report on stdout, an error on stderr; exit 1 on either failure. */
export function main(argv: string[]): number {
  try {
    const parsed = parseArgv(argv);
    if (!parsed.ok) {
      process.stderr.write(`${parsed.error}\n`);
      return 1;
    }
    const result = purgeGlobalMcps({ apply: parsed.apply, home: resolveHome() });
    for (const row of result.report) process.stdout.write(`${row.line}\n`);

    if (!result.ok) {
      process.stderr.write(`${result.error}\n`);
      return 1;
    }
    return 0;
  } catch (err) {
    process.stderr.write(`${errorText(err)}\n`);
    return 1;
  }
}
