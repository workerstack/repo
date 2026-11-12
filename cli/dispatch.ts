import { cliDeps, type CliDeps } from "./cli-deps.ts";
import { COMMANDS, isCommandName } from "./commands.ts";
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
import { HOOK_NAMES } from "./scripts/hook-command.ts";
import type { SyncIo } from "./sync.ts";

type Handler = (flags: Flags, deps: CliDeps) => Promise<void> | void;

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

function pkgVersion(packageJson: string): string {
  const pkg: unknown = JSON.parse(packageJson);

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
  ["check", (_flags, deps) => runCheck(syncIo(), deps)],
  [
    "sync",
    async (flags, deps) => {
      process.exitCode = await deps.runSync(flags.args, syncIo());
    },
  ],
  [
    "map",
    (flags, deps) => {
      process.stdout.write(deps.mapCommand(process.cwd(), flags.args[0] ?? ""));
    },
  ],
]);

function writeUsage(): void {
  process.stdout.write(usage());
}

function writeVersion(_flags: Flags, deps: CliDeps): void {
  process.stdout.write(`${pkgVersion(deps.packageJson())}\n`);
}

function handlerOf(cmd: string): Handler | undefined {
  if (HELP_COMMANDS.includes(cmd)) return writeUsage;

  if (VERSION_COMMANDS.includes(cmd)) return writeVersion;

  return BUILTINS.get(cmd);
}

/** Runs every command but init: a built-in, then a registry command in-process, else an unknown command fails. */
export async function dispatch(cmd: string, flags: Flags, deps: CliDeps = cliDeps()): Promise<void> {
  const handler = handlerOf(cmd);

  if (handler !== undefined) return handler(flags, deps);

  if (isCommandName(cmd)) {
    process.exitCode = await deps.runCommand(cmd, flags.args);

    return;
  }

  process.stderr.write(`repo: unknown command "${cmd}"; run \`repo --help\`\n`);
  process.exitCode = 1;
}
