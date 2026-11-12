#!/usr/bin/env bun
/**
 * After the subagent generator (`cli/sync/agents/subagents.ts`): Claude repo body uses Bash; other targets keep
 * run_terminal_command.
 */
import fs from "node:fs";
import path from "node:path";

import { nonEmptyOr, readTextOrNull } from "./emit-inputs.ts";

export type Frontmatter = { ok: true; fm: string; body: string } | { ok: false; error: string };

export type EmitResult = {
  ok: boolean;
  check: boolean;
  error?: string;
  drift?: string[];
};

const SSOT_REL = "agents/subagents/scout.md";
const CLAUDE_SCOUT_REL = ".claude/agents/scout.md";

export const GENERIC_TOOL_LIST =
  "read_file, grep, list_dir, run_terminal_command, write, search_replace, web_search, web_fetch";

export const CLAUDE_TOOL_LIST = "Read, Grep, Glob, Bash, Write, Edit, Web";

/** The line that opens and closes a frontmatter block. */
const FENCE = "---";

/** The line break right after the opening fence. */
const OPEN_BREAK = /^\r?\n/;

/** The closing fence on its own line. */
const CLOSE_FENCE = /\r?\n---\s*(?:\r?\n|$)/;

export function splitFrontmatter(text: string): Frontmatter {
  if (!text.startsWith(FENCE)) return { error: "missing frontmatter", ok: false };
  const rest = text.slice(FENCE.length).replace(OPEN_BREAK, "");
  const m = CLOSE_FENCE.exec(rest);

  if (m === null) return { error: "missing frontmatter close", ok: false };

  return { body: rest.slice(m.index + m[0].length), fm: rest.slice(0, m.index), ok: true };
}

export function toClaudeShellBody(body: string): string {
  return body
    .split(GENERIC_TOOL_LIST)
    .join(CLAUDE_TOOL_LIST)
    .split("web_search/web_fetch")
    .join("WebSearch/WebFetch")
    .split("run_terminal_command")
    .join("Bash");
}

function joinMarkdown(fm: string, body: string): string {
  const b = body.endsWith("\n") || body === "" ? body : `${body}\n`;

  return `---\n${fm}\n---\n${b}`;
}

/** The generated Claude scout as it is and as the scout source makes it, or the error that stops the emit. */
type ScoutPair = { ok: true; claudeRaw: string; next: string } | { ok: false; error: string };

/** Reads the scout source and the generated Claude scout and builds the scout's next text. */
function scoutPair(ssotAbs: string, claudeAbs: string): ScoutPair {
  const ssotRaw = readTextOrNull(ssotAbs);

  if (ssotRaw == null) return { error: `missing ${SSOT_REL}`, ok: false };
  const ssot = splitFrontmatter(ssotRaw);

  if (!ssot.ok) return { error: `ssot: ${ssot.error}`, ok: false };
  const claudeRaw = readTextOrNull(claudeAbs);

  if (claudeRaw == null) return { error: `missing ${CLAUDE_SCOUT_REL}`, ok: false };
  const claude = splitFrontmatter(claudeRaw);

  if (!claude.ok) return { error: `claude repo: ${claude.error}`, ok: false };

  return { claudeRaw, next: joinMarkdown(claude.fm, toClaudeShellBody(ssot.body)), ok: true };
}

/**
 * The scout source is read from `sourceRoot` (default `workspaceRoot`); the generated Claude scout under
 * `workspaceRoot` is rewritten.
 */
export function emitAgentShellTools({
  workspaceRoot,
  sourceRoot,
  check = false,
}: { workspaceRoot?: string; sourceRoot?: string; check?: boolean } = {}): EmitResult {
  const ws = nonEmptyOr(workspaceRoot, process.cwd());
  const claudeAbs = path.join(ws, CLAUDE_SCOUT_REL);
  const pair = scoutPair(path.join(nonEmptyOr(sourceRoot, ws), SSOT_REL), claudeAbs);

  if (!pair.ok) return { check, error: pair.error, ok: false };

  if (check) {
    if (pair.claudeRaw !== pair.next)
      return { check: true, drift: [CLAUDE_SCOUT_REL], error: `drift: ${CLAUDE_SCOUT_REL}`, ok: false };

    return { check: true, drift: [], ok: true };
  }

  fs.mkdirSync(path.dirname(claudeAbs), { recursive: true });
  fs.writeFileSync(claudeAbs, pair.next);

  return { check: false, ok: true };
}
