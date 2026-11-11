/** The command `repo ci` argv asks for: the gates and their flags, `skips <dir>`, `times <dir>`, `wait`, or usage. */
import {
  NO_COVERAGE_FLAG,
  REPORT_FLAG,
  SHARD_FLAG,
  SKIPS_COMMAND,
  TIMES_COMMAND,
  WAIT_COMMAND,
} from "./ci.constants.ts";
import { parseShard } from "./parse-shard.ts";

export type Command =
  | { kind: "gates"; report?: string; coverage: boolean; shard?: string | undefined }
  | { kind: "skips"; dir: string }
  | { kind: "times"; dir: string }
  | { kind: "wait"; branch?: string }
  | { kind: "wait-many" }
  | { kind: "usage"; error?: string };

/**
 * The gates run that `--no-coverage`, `--report <file>` and `--shard <i>/<n>`, in any order, ask for; refused for a
 * bad slice or one with coverage, since the per-file floors need every test, and null for anything else.
 */
function gateFlags(argv: string[]): Command | null {
  const flags: { coverage: boolean; report?: string; shard?: string } = { coverage: true };
  for (let i = 0; i < argv.length; i++) {
    const [flag, next] = [argv[i], argv[i + 1]];
    if (flag === NO_COVERAGE_FLAG) {
      flags.coverage = false;
    } else if ((flag === REPORT_FLAG || flag === SHARD_FLAG) && next !== undefined) {
      flags[flag === REPORT_FLAG ? "report" : "shard"] = next;
      i++;
    } else {
      return null;
    }
  }
  const shard = flags.shard === undefined ? { shard: undefined } : parseShard(flags.shard, flags.coverage);
  return "error" in shard ? { error: shard.error, kind: "usage" } : { kind: "gates", ...flags, ...shard };
}

/** `repo ci wait` with the branch after it, if any; more than one branch is refused. */
function waitOf(branch: string | undefined, more: string[]): Command {
  if (more.length > 0) return { kind: "wait-many" };
  return branch === undefined ? { kind: "wait" } : { branch, kind: "wait" };
}

/** What `argv` asks `repo ci` for. */
export function ciCommand(argv: string[]): Command {
  const [first, second, ...rest] = argv;
  if (first === SKIPS_COMMAND && second !== undefined && rest.length === 0) return { dir: second, kind: "skips" };
  if (first === TIMES_COMMAND && second !== undefined && rest.length === 0) return { dir: second, kind: "times" };
  if (first === WAIT_COMMAND) return waitOf(second, rest);
  return gateFlags(argv) ?? { kind: "usage" };
}
