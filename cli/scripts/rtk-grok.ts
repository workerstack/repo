#!/usr/bin/env bun
import { readEnv } from "../env.ts";
/** Grok PreToolUse: rewrite Bash/run_terminal_command through `rtk rewrite`.

Fail-open: parse error, missing rtk, timeout, no rewrite → empty stdout, exit 0.
Keep the full toolInput (Grok needs `description`); only replace `command`.
*/
import { spawnSync } from "../spawn.ts";
import type { HookInput } from "./hook-input.ts";
import { processHookIo, readHookInput, type HookIo } from "./hook-io.ts";
import { RTK_BIN, RTK_CALL, RTK_TIMEOUT_MS, ULTRA_FLAG, ULTRA_SUBS, WORD_END } from "./rtk-grok.constants.ts";

/** The groups `RTK_CALL` names; `rest` is unset when the command has no third word. */
type RtkCall = RegExpExecArray & { groups: { bin: string; sub: string; rest?: string } };
/** The tool input a hook call carries, and its command trimmed. */
type Command = { toolInput: Record<string, unknown>; cmd: string };

/** The tool input and its trimmed command; null when the input carries no command text. */
function commandOf(data: HookInput | null): Command | null {
  if (data === null) return null;
  const toolInput = data.toolInput ?? data.tool_input;
  if (toolInput === undefined) return null;
  const cmdRaw = toolInput.command;
  if (typeof cmdRaw !== "string") return null;
  const cmd = cmdRaw.trim();
  return cmd === "" ? null : { cmd, toolInput };
}

/** The command to run instead of `cmd`, or null to leave it alone. */
function replacement(cmd: string): string | null {
  const first = cmd.slice(0, cmd.search(WORD_END));
  if (first !== RTK_BIN && !first.endsWith(`/${RTK_BIN}`)) return rewrite(cmd);
  const injected = injectUltra(cmd);
  return injected === cmd ? null : injected;
}

export function main(_argv: string[] = [], io: HookIo = processHookIo()): number {
  try {
    const found = commandOf(readHookInput(io));
    if (found === null) return 0;
    const command = replacement(found.cmd);
    if (command === null) return 0;
    const updated = Object.assign({}, found.toolInput, { command });
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
  if (rewritten.includes(ULTRA_FLAG)) return rewritten;
  const m = RTK_CALL.exec(rewritten) /* the pattern names its groups */ as RtkCall | null;
  if (m === null || m.groups.bin !== RTK_BIN) return rewritten;
  const { sub, rest = "" } = m.groups;
  if (!ULTRA_SUBS.has(sub)) return rewritten;
  return `${RTK_BIN} ${sub} ${ULTRA_FLAG}${rest === "" ? "" : ` ${rest}`}`;
}

function rewrite(cmd: string): string | null {
  // Bun.which caches the PATH it started with, so pass the current one.
  const rtk = Bun.which(RTK_BIN, { PATH: readEnv().PATH ?? "" });
  if (rtk === null) return null;
  try {
    const proc = spawnSync(rtk, ["rewrite", ULTRA_FLAG, cmd], {
      encoding: "utf8",
      timeout: RTK_TIMEOUT_MS,
    });
    const out = proc.stdout.trim();
    if (out === "" || out === cmd) return null;
    return injectUltra(out);
  } catch {
    return null;
  }
}
