#!/usr/bin/env bun
/** Grok PreToolUse: rewrite Bash/run_terminal_command through `rtk rewrite`.

Fail-open: parse error, missing rtk, timeout, no rewrite → empty stdout, exit 0.
Keep the full toolInput (Grok needs `description`); only replace `command`.
*/
import { spawnSync } from "../spawn.ts";
import { readEnv } from "../env.ts";
import { processHookIo, readHookInput, type HookIo } from "./hook-io.ts";

const RTK_TIMEOUT_MS = 3000;

const ULTRA_SUBS = new Set([
  "grep",
  "rg",
  "curl",
  "wget",
  "vitest",
  "jest",
  "pytest",
  "test",
  "lint",
  "tsc",
  "npm",
  "npx",
  "read",
  "find",
  "diff",
  "json",
  "log",
  "playwright",
  "cargo",
  "ruff",
  "prettier",
  "format",
]);

export function main(_argv: string[] = [], io: HookIo = processHookIo()): number {
  try {
    const data = readHookInput(io);
    if (!data) return 0;
    const toolInput = data.toolInput ?? data.tool_input;
    if (!toolInput) return 0;
    const cmdRaw = toolInput.command;
    if (typeof cmdRaw !== "string") return 0;
    const cmd = cmdRaw.trim();
    if (!cmd) return 0;

    const first = cmd.slice(0, cmd.search(/\s|$/));
    const already = first === "rtk" || first.endsWith("/rtk");
    let rewritten: string | null;
    if (already) {
      rewritten = injectUltra(cmd);
      if (rewritten === cmd) return 0;
    } else {
      rewritten = rewrite(cmd);
      if (!rewritten) return 0;
    }

    const updated = Object.assign({}, toolInput, { command: rewritten });
    io.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecisionReason: "RTK auto-rewrite",
          updatedInput: updated,
        },
      }),
    );
    return 0;
  } catch {
    return 0;
  }
}

function injectUltra(rewritten: string): string {
  if (rewritten.includes("--ultra-compact")) return rewritten;
  const m = rewritten.match(/^(\S+)\s+(\S+)(?:\s+([\s\S]*))?$/);
  if (!m || m[1] !== "rtk") return rewritten;
  // Groups 1 and 2 are required, so they are strings once the match succeeded.
  const sub = m[2]!;
  if (!ULTRA_SUBS.has(sub)) return rewritten;
  const rest = m[3] || "";
  return "rtk " + sub + " --ultra-compact" + (rest ? " " + rest : "");
}

function rewrite(cmd: string): string | null {
  // Bun.which caches the PATH it started with, so pass the current one.
  const rtk = Bun.which("rtk", { PATH: readEnv().PATH ?? "" });
  if (!rtk) return null;
  try {
    const proc = spawnSync(rtk, ["rewrite", "--ultra-compact", cmd], {
      encoding: "utf8",
      timeout: RTK_TIMEOUT_MS,
    });
    const out = (proc.stdout || "").trim();
    if (!out || out === cmd) return null;
    return injectUltra(out);
  } catch {
    return null;
  }
}
