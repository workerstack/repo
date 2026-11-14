/**
 * The argument edge of `repo eval`: the name, `--dry-run`, the cap, the `--changed` base and `--via`, or the one line
 * saying what is wrong.
 */
import type { Via } from "../eval/estimate.ts";
import { VIAS } from "../eval/price.constants.ts";
import {
  CHANGED_FLAG,
  DEFAULT_CAPS,
  DRY_RUN_FLAG,
  EVAL_USAGE,
  EXIT_USAGE,
  MAX_COST_FLAG,
  VIA_FLAG,
  VIA_LINE,
} from "./eval.constants.ts";

const NOT_FOUND = -1;

export type Args = { name: string; isDryRun: boolean; cap: number; via: Via; changed?: string };

const FLAGS: readonly string[] = [DRY_RUN_FLAG, MAX_COST_FLAG, CHANGED_FLAG, VIA_FLAG];
const VALUED: readonly string[] = [MAX_COST_FLAG, CHANGED_FLAG, VIA_FLAG];

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

/** The `--via` value: session when absent, or null for a missing value or one that is neither session nor api. */
function viaOf(argv: readonly string[]): Via | null {
  const at = argv.indexOf(VIA_FLAG);

  if (at === NOT_FOUND) return "session";
  const value = argv[at + 1];

  return VIAS.find((via) => via === value) ?? null;
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
  const via = viaOf(argv);

  if (via === null) return refuse(VIA_LINE);
  const at = argv.indexOf(MAX_COST_FLAG);
  const value = argv[at + 1] ?? "";
  const cap = at === NOT_FOUND ? DEFAULT_CAPS[via] : capOf(value);

  if (Number.isNaN(cap))
    return refuse(`eval: ${MAX_COST_FLAG} needs a positive number of dollars, got ${JSON.stringify(value)}`);

  const args: Args = { cap, isDryRun: argv.includes(DRY_RUN_FLAG), name, via };

  return { args: changed === undefined ? args : { ...args, changed }, ok: true };
}
