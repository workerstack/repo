/** The argv of one `bun repo env` verb, read against what the verb takes. */
import { COMMAND_START, KEY_NAME, SCOPES } from "./env-command.constants.ts";

/** What a verb takes: how many words, which flags with a value, which alone, and whether `-- cmd` follows. */
export type ArgSpec = {
  readonly words: number;
  readonly values: readonly string[];
  readonly switches: readonly string[];
  readonly command: "none" | "required";
};

/** A verb's argv, read: its words, flag values, switches and the command after `--`. */
export type EnvArgs = {
  readonly words: readonly string[];
  readonly values: ReadonlyMap<string, string>;
  readonly switches: ReadonlySet<string>;
  readonly command: readonly string[];
};

/** `argv` read against `spec`, or null when it names an unknown flag, misses a value or has the wrong words. */
export function parseArgs(argv: readonly string[], spec: ArgSpec): EnvArgs | null {
  const hasCommand = argv.includes(COMMAND_START);
  const dash = argv.indexOf(COMMAND_START);
  const flags = hasCommand ? argv.slice(0, dash) : argv;
  const command = hasCommand ? argv.slice(dash + 1) : [];

  if ((spec.command === "required") !== command.length > 0) return null;
  const words: string[] = [];
  const values = new Map<string, string>();
  const switches = new Set<string>();

  for (let index = 0; index < flags.length; index += 1) {
    const arg = String(flags[index]);
    const value = flags[index + 1];

    if (spec.values.includes(arg)) {
      if (value === undefined) return null;
      values.set(arg, value);
      index += 1;
    } else if (spec.switches.includes(arg)) {
      switches.add(arg);
    } else if (arg.startsWith("-")) {
      return null;
    } else {
      words.push(arg);
    }
  }

  return words.length === spec.words ? { command, switches, values, words } : null;
}

/** Whether `name` is a key an env block can hold unquoted. */
export function isKeyName(name: string | undefined): name is string {
  return name !== undefined && KEY_NAME.test(name);
}

/** Whether `name` is global or one of the three scopes. */
export function isScopeName(name: string | undefined): name is string {
  return name !== undefined && SCOPES.includes(name);
}
