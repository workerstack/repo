#!/usr/bin/env bun
/** Inner generate/check/watch chain. Called by guarded-roots; not a public package script. */
import { execSync, type ExecSyncOptions } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripJsonc } from "./jsonc.ts";

export const PIPELINE_CONFIG_REL = ".rulesync/repo.pipeline.jsonc";

export type PipelineMode = "generate" | "check" | "watch";
/** execSync options as this pipeline passes them: `shell: true` is valid at runtime, though Node types it as a string. */
export type PipelineExecOptions = Omit<ExecSyncOptions, "shell"> & { shell?: boolean | string };
export type ExecFn = (cmd: string, opts: PipelineExecOptions) => unknown;

export const defaultExec: ExecFn = (cmd, opts) => execSync(cmd, opts as ExecSyncOptions);
export type PipelineWarn = (message: string) => void;
export interface PipelineOverlay {
  skip: string[];
  extra: string[];
}
export interface PipelineOptions {
  cwd?: string;
  exec?: ExecFn;
  warn?: PipelineWarn;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  // Callers may throw plain `{ message }` objects, which the check report has always shown by message.
  if (err !== null && typeof err === "object" && "message" in err && typeof err.message === "string" && err.message) return err.message;
  return String(err);
}

export const COMMANDS: Record<PipelineMode, string[]> = {
  generate: [
    "rulesync generate -t codexcli,antigravity-cli,grokcli -f rules",
    "rulesync generate -t claudecode,codexcli,antigravity-cli,grokcli,cursor -f subagents",
    "rulesync generate -t claudecode,codexcli,antigravity-cli,cursor -f hooks",
    "bun .rulesync/scripts/emit-mcp-policy.ts",
    "bun .rulesync/scripts/emit-agent-shell-tools.ts",
    "bun .rulesync/scripts/emit-skill-links.ts",
    "bun .rulesync/scripts/emit-maps.ts",
    "bun .rulesync/scripts/hooks-union.ts",
    "bun .rulesync/scripts/vscode-tasks.ts",
  ],
  check: [
    "rulesync generate -t codexcli,antigravity-cli,grokcli -f rules --check",
    "rulesync generate -t codexcli,antigravity-cli,grokcli,cursor -f subagents --check",
    "rulesync generate -t claudecode,codexcli,antigravity-cli,cursor -f hooks --check",
    "bun .rulesync/scripts/emit-mcp-policy.ts --check",
    "bun .rulesync/scripts/emit-agent-shell-tools.ts --check",
    "bun .rulesync/scripts/emit-skill-links.ts --check",
    "bun .rulesync/scripts/emit-maps.ts --check",
    "bun .rulesync/scripts/hooks-union.ts --check",
  ],
  watch: [
    "bun .rulesync/scripts/emit-mcp-policy.ts",
    "bun .rulesync/scripts/emit-agent-shell-tools.ts",
    "rulesync generate -t claudecode,codexcli,antigravity-cli,grokcli -f rules,subagents --watch",
  ],
};

export function envWithLocalBin(cwd: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const binDir = path.join(cwd, "node_modules", ".bin");
  const merged = { ...env };
  const key = Object.keys(merged).find((k) => k.toLowerCase() === "path") || "PATH";
  merged[key] = `${binDir}${path.delimiter}${merged[key] || ""}`;
  return merged;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isPipelineMode(mode: string): mode is PipelineMode {
  return Object.hasOwn(COMMANDS, mode);
}

function asStringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : [];
}

export function loadPipelineOverlay(
  cwd: string,
  mode: string,
  warn: PipelineWarn = (m) => process.stderr.write(`${m}\n`),
): PipelineOverlay {
  const abs = path.join(cwd, PIPELINE_CONFIG_REL);
  if (!fs.existsSync(abs)) return { skip: [], extra: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(stripJsonc(fs.readFileSync(abs, "utf8")));
  } catch (err) {
    warn(`pipeline: ignoring ${PIPELINE_CONFIG_REL}: ${errorMessage(err)}`);
    return { skip: [], extra: [] };
  }
  const section: unknown = isRecord(raw) ? raw[mode] : null;
  if (!isRecord(section)) {
    return { skip: [], extra: [] };
  }
  return { skip: asStringList(section.skip), extra: asStringList(section.extra) };
}

export function resolvePipelineCommands(mode: string, cwd: string, warn?: PipelineWarn): string[] | null {
  const stock = isPipelineMode(mode) ? COMMANDS[mode] : null;
  if (!stock) return null;
  const { skip, extra } = loadPipelineOverlay(cwd, mode, warn);
  const skipSet = new Set(skip);
  return [...stock.filter((c) => !skipSet.has(c)), ...extra];
}

export function formatCheckFailures(failures: { cmd: string; err: unknown }[]): string {
  const n = failures.length;
  const lines = [`pipeline check failed (${n} step${n === 1 ? "" : "s"}):`];
  for (const { cmd, err } of failures) {
    lines.push(`- ${cmd}`);
    const msg = errorMessage(err);
    for (const line of msg.split(/\r?\n/)) {
      if (line) lines.push(`  ${line}`);
    }
  }
  lines.push(
    "If a consumer post-step rewrites this output (hooks-union, codex-sync), add the stock command to check.skip in .rulesync/repo.pipeline.jsonc",
  );
  return lines.join("\n");
}

export function runPipeline(mode: string, { cwd = process.cwd(), exec = defaultExec, warn }: PipelineOptions = {}): void {
  const cmds = resolvePipelineCommands(mode, cwd, warn);
  if (!cmds) {
    throw new Error("usage: pipeline.ts generate|check|watch");
  }
  const env = envWithLocalBin(cwd);
  if (mode === "check") {
    const failures: { cmd: string; err: unknown }[] = [];
    for (const cmd of cmds) {
      try {
        exec(cmd, { cwd, stdio: "inherit", shell: true, env });
      } catch (err) {
        failures.push({ cmd, err });
      }
    }
    if (failures.length) throw new Error(formatCheckFailures(failures));
    return;
  }
  for (const cmd of cmds) {
    exec(cmd, { cwd, stdio: "inherit", shell: true, env });
  }
}

function main() {
  try {
    runPipeline(process.argv[2] || "");
    return 0;
  } catch (err) {
    process.stderr.write(errorMessage(err) + "\n");
    return 1;
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile) process.exit(main());
