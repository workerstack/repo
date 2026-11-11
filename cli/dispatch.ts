import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { COMMANDS, isCommandName, runCommand } from "./commands.ts";
import {
  HELP_COMMANDS,
  HELP_PAD,
  USAGE_BUILTINS,
  USAGE_FLAGS,
  USAGE_HEAD,
  USAGE_TAIL_ROWS,
  VERSION_COMMANDS,
} from "./main.constants.ts";
import type { Flags } from "./parse-argv.ts";
import { runCheck } from "./run-check.ts";
import { mapCommand } from "./scripts/folder-map.ts";
import { HOOK_NAMES } from "./scripts/hook-command.ts";
import { runSync, type SyncIo } from "./sync.ts";

type Handler = (flags: Flags) => Promise<void> | void;

function row([name, summary]: readonly [string, string]): string {
  return `  ${name.padEnd(HELP_PAD)}${summary}\n`;
}

/** `repo help`: the built-in commands, the registry's, the hooks, then the flags. */
export function usage(): string {
  const rows = [
    ...USAGE_BUILTINS.map(row),
    ...Object.entries(COMMANDS).map(([name, entry]) => row([name, entry.summary])),
    row(["hook <name>", `Run a hook: ${HOOK_NAMES.join(", ")}`]),
    ...USAGE_TAIL_ROWS.map(row),
  ];
  return `${USAGE_HEAD}\nCommands:\n${rows.join("")}\n${USAGE_FLAGS}`;
}

function pkgVersion(): string {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const pkg: unknown = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  if (typeof pkg !== "object" || pkg === null || !("version" in pkg) || typeof pkg.version !== "string")
    throw new Error("package.json has no version");

  return pkg.version;
}

function syncIo(): SyncIo {
  return {
    cwd: process.cwd(),
    stderr: (s: string) => process.stderr.write(s),
    stdout: (s: string) => process.stdout.write(s),
  };
}

/** The commands this file runs itself, by name; help and version go by any of their spellings. */
const BUILTINS: ReadonlyMap<string, Handler> = /* @__PURE__ */ new Map<string, Handler>([
  ["check", () => runCheck(syncIo())],
  [
    "sync",
    async (flags) => {
      process.exitCode = await runSync(flags.args, syncIo());
    },
  ],
  [
    "map",
    (flags) => {
      process.stdout.write(mapCommand(process.cwd(), flags.args[0] ?? ""));
    },
  ],
]);

function writeUsage(): void {
  process.stdout.write(usage());
}

function writeVersion(): void {
  process.stdout.write(`${pkgVersion()}\n`);
}

function handlerOf(cmd: string): Handler | undefined {
  if (HELP_COMMANDS.includes(cmd)) return writeUsage;
  if (VERSION_COMMANDS.includes(cmd)) return writeVersion;
  return BUILTINS.get(cmd);
}

/** Runs every command but init: a built-in, then a registry command in-process, else an unknown command fails. */
export async function dispatch(cmd: string, flags: Flags): Promise<void> {
  const handler = handlerOf(cmd);
  if (handler !== undefined) return handler(flags);
  if (isCommandName(cmd)) {
    process.exitCode = await runCommand(cmd, flags.args);
    return;
  }
  process.stderr.write(`repo: unknown command "${cmd}"; run \`repo --help\`\n`);
  process.exitCode = 1;
}
