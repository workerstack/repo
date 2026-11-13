/**
 * The argument edge of `repo eval`: the name, `--dry-run`, the cap and the `--changed` base, or the one line saying
 * what is wrong.
 */
import { CHANGED_FLAG, DEFAULT_CAP, DRY_RUN_FLAG, EVAL_USAGE, EXIT_USAGE, MAX_COST_FLAG } from "./eval.constants.ts";

const NOT_FOUND = -1;

export type Args = { name: string; isDryRun: boolean; cap: number; changed?: string };

const FLAGS: readonly string[] = [DRY_RUN_FLAG, MAX_COST_FLAG, CHANGED_FLAG];
const VALUED: readonly string[] = [MAX_COST_FLAG, CHANGED_FLAG];

export type Parsed = { ok: true; args: Args } | { ok: false; line: string; code: number };

/** The cap in dollars, or NaN for anything that is not a positive number. */
function capOf(value: string): number {
  const cap = value.trim() === "" ? Number.NaN : Number(value);

  return cap > 0 ? cap : Number.NaN;
}

function refuse(line: string): Parsed {
  return { code: EXIT_USAGE, line, ok: false };
}

/** The `--changed` base: absent, a git base, or null for a missing value or one that is another flag. */
function baseOf(argv: readonly string[]): string | null | undefined {
  const at = argv.indexOf(CHANGED_FLAG);

  if (at === NOT_FOUND) return undefined;
  const value = argv[at + 1] ?? "";

  return value === "" || value.startsWith("-") ? null : value;
}

export function parseArgs(argv: readonly string[]): Parsed {
  const own = argv.filter((_arg, i) => !VALUED.includes(argv[i - 1] ?? ""));
  const names = own.filter((arg) => !arg.startsWith("-"));
  const flags = own.filter((arg) => arg.startsWith("-"));
  const [name] = names;

  if (name === undefined || names.length > 1) return refuse(EVAL_USAGE);

  if (flags.some((flag) => !FLAGS.includes(flag))) return refuse(EVAL_USAGE);
  const changed = baseOf(argv);

  if (changed === null) return refuse(`eval: ${CHANGED_FLAG} needs a git base, such as main`);
  const at = argv.indexOf(MAX_COST_FLAG);
  const value = argv[at + 1] ?? "";
  const cap = at === NOT_FOUND ? DEFAULT_CAP : capOf(value);

  if (Number.isNaN(cap))
    return refuse(`eval: ${MAX_COST_FLAG} needs a positive number of dollars, got ${JSON.stringify(value)}`);

  const args: Args = { cap, isDryRun: argv.includes(DRY_RUN_FLAG), name };

  return { args: changed === undefined ? args : { ...args, changed }, ok: true };
}
