import { parsePacksFlag } from "./init.ts";
import { FLAG_PREFIX, PACKS_FLAG, PACKS_PREFIX, SKIP_GLOBALS_FLAG, YES_FLAGS } from "./main.constants.ts";

/** The command line, split into the command, its arguments and the flags this CLI knows. */
export type Flags = {
  cmd: string | undefined;
  args: string[];
  skipGlobals: boolean;
  packs: string[] | undefined;
  packsError: boolean;
};

type State = { skipGlobals: boolean; packs: string[] | undefined; packsError: boolean; positionals: string[] };

/** Sets the packs a `--packs` value names; a value naming an unknown pack is an error and leaves them as they were. */
function setPacks(state: State, value: string): void {
  try {
    state.packs = parsePacksFlag(value);
  } catch {
    state.packsError = true;
  }
}

/** Reads `--packs <list>`; whether it took `next` as the list, which a missing value or another flag never is. */
function readPacksPair(next: string | undefined, state: State): boolean {
  if (next === undefined || next.startsWith(FLAG_PREFIX)) {
    state.packsError = true;
    return false;
  }
  setPacks(state, next);
  return true;
}

/** Reads one argument into `state`; whether it also took the argument after it. */
function readArg(arg: string, next: string | undefined, state: State): boolean {
  if (arg === SKIP_GLOBALS_FLAG) state.skipGlobals = true;
  else if (arg === PACKS_FLAG) return readPacksPair(next, state);
  else if (arg.startsWith(PACKS_PREFIX)) setPacks(state, arg.slice(PACKS_PREFIX.length));
  else if (!YES_FLAGS.has(arg)) state.positionals.push(arg);
  return false;
}

export function parseArgv(argv: readonly string[]): Flags {
  const state: State = { packs: undefined, packsError: false, positionals: [], skipGlobals: false };
  let isTaken = false;
  for (const [i, arg] of argv.entries()) isTaken = isTaken ? false : readArg(arg, argv[i + 1], state);

  const { skipGlobals, packs, packsError, positionals } = state;
  return { args: positionals.slice(1), cmd: positionals[0], packs, packsError, skipGlobals };
}
