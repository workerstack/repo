/** The command line of `repo mutate`, parsed at the edge into one of three shapes. */
import {
  ASSIGN,
  CHECK_COMMAND,
  FIRST_SHARD,
  FLAG_PREFIX,
  FLAG_WORDS,
  REPORT_FLAG,
  SHARD_FLAG,
  SHARD_PATTERN,
  WRITE_FLAG,
} from "./mutate.constants.ts";

/** The `index`th of `total` shards, 1-based. */
export type Shard = { index: number; total: number };

export type Args =
  | { kind: "run"; shard: Shard; report: string | undefined }
  | { kind: "check"; dir: string; write: boolean }
  | { kind: "error"; line: string };

const fail = (line: string): Args => ({ kind: "error", line });
const SHARD_USAGE = `${SHARD_FLAG} takes i/n with 1 <= i <= n, such as 2/8`;
const REPORT_USAGE = `${REPORT_FLAG} takes a file path`;
const UNKNOWN = `use ${SHARD_FLAG} i/n, ${REPORT_FLAG} <file> or ${CHECK_COMMAND} <dir>`;

/** `i/n` as a shard, or null when it is no shard. */
function shardOf(text: string): Shard | null {
  const match = SHARD_PATTERN.exec(text);
  const [, first, second] = match ?? [];
  const index = Number(first);
  const total = Number(second);
  return match !== null && index >= FIRST_SHARD && index <= total ? { index, total } : null;
}

/** `--flag=value` as the two words `--flag value`. */
function expand(argv: string[]): string[] {
  return argv.flatMap((word) => {
    const at = word.indexOf(ASSIGN);
    return word.startsWith(FLAG_PREFIX) && at > 0 ? [word.slice(0, at), word.slice(at + 1)] : [word];
  });
}

function parseCheck(rest: string[]): Args {
  const dir = rest.find((word) => word !== WRITE_FLAG);
  if (dir === undefined) return fail(`${CHECK_COMMAND} takes the dir of the shard reports`);
  return { kind: "check", dir, write: rest.includes(WRITE_FLAG) };
}

type Run = Extract<Args, { kind: "run" }>;

/** Applies one flag and its value to `run`; the line that says what is wrong, or null. */
function apply(run: Run, flag: string | undefined, value: string | undefined): string | null {
  if (flag === SHARD_FLAG) {
    const shard = shardOf(value ?? "");
    if (shard === null) return SHARD_USAGE;
    run.shard = shard;
    return null;
  }
  if (flag !== REPORT_FLAG) return `unknown argument "${String(flag)}"; ${UNKNOWN}`;
  if (value === undefined || value === "" || value.startsWith(FLAG_PREFIX)) return REPORT_USAGE;
  run.report = value;
  return null;
}

function parseRun(words: string[]): Args {
  const run: Run = { kind: "run", shard: { index: FIRST_SHARD, total: FIRST_SHARD }, report: undefined };
  for (let at = 0; at < words.length; at += FLAG_WORDS) {
    const problem = apply(run, words[at], words[at + 1]);
    if (problem !== null) return fail(problem);
  }
  return run;
}

/** The run `argv` asks for, or the line that says what is wrong with it. */
export function parseArgs(argv: string[]): Args {
  const words = expand(argv);
  return words[0] === CHECK_COMMAND ? parseCheck(words.slice(1)) : parseRun(words);
}
