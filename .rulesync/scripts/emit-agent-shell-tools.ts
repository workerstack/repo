#!/usr/bin/env bun
/** After rulesync subagent emit: Claude repo body uses Bash; other targets keep run_terminal_command. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isRecord } from "./hook-input.ts";

export type ParsedArgv = { ok: true; check: boolean } | { ok: false; error: string };
export type Frontmatter = { ok: true; fm: string; body: string } | { ok: false; error: string };

export interface EmitResult {
  ok: boolean;
  check: boolean;
  error?: string;
  drift?: string[];
}

export const SSOT_REL = ".rulesync/subagents/scout.md";
export const CLAUDE_SCOUT_REL = ".claude/agents/scout.md";

export const GENERIC_TOOL_LIST =
  "read_file, grep, list_dir, run_terminal_command, write, search_replace, web_search, web_fetch";
export const CLAUDE_TOOL_LIST = "Read, Grep, Glob, Bash, Write, Edit, Web";

export function parseArgv(argv: unknown): ParsedArgv {
  const args: unknown[] = Array.isArray(argv) ? argv : [];
  let check = false;
  for (const a of args) {
    if (a === "--check") {
      check = true;
      continue;
    }
    return { ok: false, error: `unknown flag: ${a}` };
  }
  return { ok: true, check };
}

export function splitFrontmatter(text: unknown): Frontmatter {
  const src = String(text ?? "");
  if (!src.startsWith("---")) return { ok: false, error: "missing frontmatter" };
  const rest = src.slice(3).replace(/^\r?\n/, "");
  const m = rest.match(/\r?\n---\s*(?:\r?\n|$)/);
  if (!m || m.index == null) return { ok: false, error: "missing frontmatter close" };
  return { ok: true, fm: rest.slice(0, m.index), body: rest.slice(m.index + m[0].length) };
}

export function toClaudeShellBody(body: unknown): string {
  return String(body)
    .split(GENERIC_TOOL_LIST)
    .join(CLAUDE_TOOL_LIST)
    .split("web_search/web_fetch")
    .join("WebSearch/WebFetch")
    .split("run_terminal_command")
    .join("Bash");
}

function readText(abs: string): string | null {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch (err) {
    if (isRecord(err) && err.code === "ENOENT") return null;
    throw err;
  }
}

function joinMarkdown(fm: string, body: string): string {
  const b = body.endsWith("\n") || body === "" ? body : `${body}\n`;
  return `---\n${fm}\n---\n${b}`;
}

/** The scout source is read from `sourceRoot` (default `workspaceRoot`); the generated Claude scout under `workspaceRoot` is rewritten. */
export function emitAgentShellTools({
  workspaceRoot,
  sourceRoot,
  check = false,
}: { workspaceRoot?: string; sourceRoot?: string; check?: boolean } = {}): EmitResult {
  const ws = workspaceRoot || process.cwd();
  const ssotAbs = path.join(sourceRoot || ws, SSOT_REL);
  const claudeAbs = path.join(ws, CLAUDE_SCOUT_REL);
  const ssotRaw = readText(ssotAbs);
  if (ssotRaw == null) {
    return { ok: false, check, error: `missing ${SSOT_REL}` };
  }
  const ssot = splitFrontmatter(ssotRaw);
  if (!ssot.ok) {
    return { ok: false, check, error: `ssot: ${ssot.error}` };
  }
  const claudeRaw = readText(claudeAbs);
  if (claudeRaw == null) {
    return { ok: false, check, error: `missing ${CLAUDE_SCOUT_REL}` };
  }
  const claude = splitFrontmatter(claudeRaw);
  if (!claude.ok) {
    return { ok: false, check, error: `claude repo: ${claude.error}` };
  }
  const next = joinMarkdown(claude.fm, toClaudeShellBody(ssot.body));
  if (check) {
    if (claudeRaw !== next) {
      return { ok: false, check: true, error: `drift: ${CLAUDE_SCOUT_REL}`, drift: [CLAUDE_SCOUT_REL] };
    }
    return { ok: true, check: true, drift: [] };
  }
  fs.mkdirSync(path.dirname(claudeAbs), { recursive: true });
  fs.writeFileSync(claudeAbs, next);
  return { ok: true, check: false };
}

function main() {
  try {
    const parsed = parseArgv(process.argv.slice(2));
    if (!parsed.ok) {
      process.stderr.write((parsed.error || "invalid argv") + "\n");
      return 1;
    }
    const result = emitAgentShellTools({
      workspaceRoot: process.cwd(),
      check: parsed.check,
    });
    if (!result.ok) {
      process.stderr.write((result.error || "emit failed") + "\n");
      return 1;
    }
    return 0;
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n");
    return 1;
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile || import.meta.url === pathToFileURL(invoked).href) {
  process.exit(main());
}
