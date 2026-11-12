/** The consumer script commands the union writes, and the tables that say which hook each joins. */
import { hookCommand } from "./hook-command.ts";
import {
  AGY_WRITE_MATCHER,
  BEHIND_SCRIPT,
  FLEET_SCRIPT,
  PULL_SCRIPT,
  ROOT_PREFIX,
  RTK_SCRIPT,
  SIM_SCRIPT,
  VALIDATE_SCRIPT,
} from "./hooks-union.constants.ts";
import type { NamedHook } from "./hooks-union.types.ts";

/** Hook command for `rel`: the script in the project dir, else at that dir's git top level, else in the hook cwd. */
export function rootCmd(rel: string, args?: string): string {
  const cmd =
    `${ROOT_PREFIX}${rel}" ] || ` +
    `d="$(git -C "$d" rev-parse --show-toplevel 2>/dev/null || echo "$d")"; bun "$d/${rel}"`;

  return args === undefined || args === "" ? cmd : `${cmd} ${args}`;
}

/** Whether `command` is exactly a `rootCmd` string, with or without arguments. */
export function isRootCmd(command: string): boolean {
  if (!command.startsWith(ROOT_PREFIX)) return false;
  const rel = command.slice(ROOT_PREFIX.length).split('"', 1).join("");
  const exact = rootCmd(rel);

  return command === exact || command.startsWith(`${exact} `);
}

const HOOK_ARG = "--hook";
const PULL: string = /* @__PURE__ */ rootCmd(`scripts/${PULL_SCRIPT}`);
const RTK: string = /* @__PURE__ */ rootCmd(`scripts/${RTK_SCRIPT}`);
const FLEET: string = /* @__PURE__ */ rootCmd(`scripts/${FLEET_SCRIPT}`);
export const BEHIND: string = /* @__PURE__ */ rootCmd(`scripts/${BEHIND_SCRIPT}`, HOOK_ARG);
const VALIDATE: string = /* @__PURE__ */ rootCmd(`scripts/${VALIDATE_SCRIPT}`, HOOK_ARG);
const SIM: string = /* @__PURE__ */ rootCmd(`scripts/${SIM_SCRIPT}`, HOOK_ARG);
export const MAP: string = /* @__PURE__ */ hookCommand("session-map");

/** A consumer script and the command that runs it. */
type Extra = readonly [script: string, command: string];

/** The consumer's SessionStart extras, in run order. */
export const SESSION_EXTRAS: readonly Extra[] = [
  [PULL_SCRIPT, PULL],
  [RTK_SCRIPT, RTK],
  [FLEET_SCRIPT, FLEET],
];

/** The consumer's PostToolUse extras, in run order. */
export const POST_EXTRAS: readonly Extra[] = [
  [VALIDATE_SCRIPT, VALIDATE],
  [SIM_SCRIPT, SIM],
];

/** Antigravity's flat consumer entries: the script each needs, its name and the entry. */
export const NAMED_EXTRAS: readonly { script: string; name: string; hook: NamedHook }[] = [
  { hook: { command: PULL, event: "SessionStart" }, name: "daily-pull-all", script: PULL_SCRIPT },
  { hook: { command: RTK, event: "SessionStart" }, name: "rtk-check", script: RTK_SCRIPT },
  { hook: { command: FLEET, event: "SessionStart" }, name: "daily-fleet-digest", script: FLEET_SCRIPT },
  {
    hook: { command: BEHIND, event: "PreToolUse", matcher: AGY_WRITE_MATCHER },
    name: "check-behind",
    script: BEHIND_SCRIPT,
  },
  {
    hook: { command: VALIDATE, event: "PostToolUse", matcher: AGY_WRITE_MATCHER },
    name: "validate-artifact",
    script: VALIDATE_SCRIPT,
  },
  {
    hook: { command: SIM, event: "PostToolUse", matcher: AGY_WRITE_MATCHER },
    name: "simulate-artifact",
    script: SIM_SCRIPT,
  },
];
