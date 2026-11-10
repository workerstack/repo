import {
  CHECK_FLAG,
  DEFAULT_REF,
  DEFAULT_REPO,
  NO_GENERATE_FLAG,
  REF_FLAG,
  REPO_FLAG,
  VALUE_FLAGS,
} from "./sync-pstack-skills.constants.ts";

/** The parsed command line, or the reason it is invalid. */
export type ParsedArgv =
  | { ok: false; error: string }
  | { ok: true; check: boolean; generate: boolean; ref: string; repo: string; skills: string[] };

interface Draft {
  check: boolean;
  generate: boolean;
  ref: string;
  repo: string;
  skills: string[];
}

/** The value after a flag, undefined when it is missing or looks like another flag. */
function valueAfter(args: string[], i: number): string | undefined {
  const value = args[i + 1];
  return value == null || value.startsWith("-") ? undefined : value;
}

function store(out: Draft, flag: string, value: string): void {
  if (flag === REF_FLAG) out.ref = value;
  else if (flag === REPO_FLAG) out.repo = value;
  else out.skills.push(value);
}

/** Fold `args` into `out`; returns the error of the first bad flag, else null. */
function fold(args: string[], out: Draft): string | null {
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i] ?? "";
    if (flag === CHECK_FLAG) out.check = true;
    else if (flag === NO_GENERATE_FLAG) out.generate = false;
    else if (VALUE_FLAGS.includes(flag)) {
      const value = valueAfter(args, i);
      if (value === undefined) return `${flag} needs a value`;
      i += 1;
      store(out, flag, value);
    } else return `unknown flag: ${flag}`;
  }
  return null;
}

export function parseArgv(argv: unknown): ParsedArgv {
  const args: string[] = Array.isArray(argv) ? argv.map(String) : [];
  const out: Draft = { check: false, generate: true, ref: DEFAULT_REF, repo: DEFAULT_REPO, skills: [] };
  const error = fold(args, out);
  return error === null ? { ok: true, ...out } : { ok: false, error };
}
