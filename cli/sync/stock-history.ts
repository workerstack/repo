import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Hashes of every version of each stock path a copied install can hold, by repo-relative path; see `dev/stock-history.ts`. */
export type StockHistory = Record<string, readonly string[]>;

/**
 * The stock paths the migration compares a copy against: rules, subagents, the generated agent files, skills, hooks, MCP policy, scripts, global
 * settings, the old reference dir and its successor, the Claude settings and AGENTS.md. A prefix ending in `/`
 * covers a dir; any other entry is one file.
 */
export const STOCK_PREFIXES = [
  ".rulesync/rules/",
  ".rulesync/subagents/",
  ".rulesync/hooks.jsonc",
  ".rulesync/mcp-policy.jsonc",
  ".rulesync/global-settings/",
  ".rulesync/settings/",
  ".rulesync/repo.pipeline.jsonc",
  ".rulesync/scripts/",
  ".rulesync/reference/",
  "references/",
  ".agents/agents/",
  ".claude/agents/",
  ".codex/agents/",
  ".cursor/agents/",
  ".grok/agents/",
  ".agents/skills/",
  ".claude/settings.json",
  "AGENTS.md",
] as const;

/** The table key for the hashes of every hook command any stock `.claude/settings.json` ever held. */
export const HOOK_COMMANDS_KEY = ".claude/settings.json#commands";

/** Every hook `command` string under the `hooks` of a parsed settings file. */
export function hookCommands(settings: unknown): string[] {
  const found: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === "object" && value !== null) {
      for (const [key, entry] of Object.entries(value)) {
        if (key === "command" && typeof entry === "string") found.push(entry);
        else walk(entry);
      }
    }
  };
  walk((settings as { hooks?: unknown } | null)?.hooks);
  return found;
}

export const STOCK_HISTORY_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "stock-history.json");

/** The first 16 hex digits of the sha256 of `bytes` read as text with LF line endings, so a CRLF checkout hashes alike. */
export function hashText(bytes: Buffer | string): string {
  const text = typeof bytes === "string" ? bytes : bytes.toString("utf8");
  return createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex").slice(0, 16);
}

/** The shipped table of stock file hashes. */
export function readStockHistory(file: string = STOCK_HISTORY_FILE): StockHistory {
  return JSON.parse(fs.readFileSync(file, "utf8")) as StockHistory;
}
