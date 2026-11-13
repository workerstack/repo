/** The argument edge of `repo eval`: the name, `--dry-run` and the cap, or the one line saying what is wrong. */
import { DEFAULT_CAP, DRY_RUN_FLAG, EVAL_USAGE, EXIT_USAGE, MAX_COST_FLAG } from "./eval.constants.ts";

const NOT_FOUND = -1;

export type Args = { name: string; isDryRun: boolean; cap: number };

export type Parsed = { ok: true; args: Args } | { ok: false; line: string; code: number };

/** The cap in dollars, or NaN for anything that is not a positive number. */
function capOf(value: string): number {
  const cap = value.trim() === "" ? Number.NaN : Number(value);

  return cap > 0 ? cap : Number.NaN;
}

function refuse(line: string): Parsed {
  return { code: EXIT_USAGE, line, ok: false };
}

export function parseArgs(argv: readonly string[]): Parsed {
  const own = argv.filter((_arg, i) => argv[i - 1] !== MAX_COST_FLAG);
  const names = own.filter((arg) => !arg.startsWith("-"));
  const flags = own.filter((arg) => arg.startsWith("-"));
  const [name] = names;

  if (name === undefined || names.length > 1) return refuse(EVAL_USAGE);

  if (flags.some((flag) => flag !== DRY_RUN_FLAG && flag !== MAX_COST_FLAG)) return refuse(EVAL_USAGE);
  const at = argv.indexOf(MAX_COST_FLAG);
  const value = argv[at + 1] ?? "";
  const cap = at === NOT_FOUND ? DEFAULT_CAP : capOf(value);

  if (Number.isNaN(cap))
    return refuse(`eval: ${MAX_COST_FLAG} needs a positive number of dollars, got ${JSON.stringify(value)}`);

  return { args: { cap, isDryRun: argv.includes(DRY_RUN_FLAG), name }, ok: true };
}
