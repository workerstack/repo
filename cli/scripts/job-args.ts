import path from "node:path";
import { canonicalPath } from "./workspace-root.ts";
import {
  CWD_FLAG,
  FLAG_PREFIX,
  FROM_FLAG,
  GLOB_FLAG,
  JOB_FLAG,
  KNOWN_FLAGS,
  PATH_FLAG,
  QUERY_FLAG,
  STASH_FLAG,
  TO_FLAG,
} from "./job.constants.ts";
import type { FlagValue, ParsedArgs } from "./job.types.ts";

/** The known flag `a` spells, alone or as `flag=value`; null for a stray word or an unknown flag. */
function flagOf(a: string): string | null {
  if (!a.startsWith(FLAG_PREFIX)) return null;
  const eq = a.indexOf("=");
  const prefix = eq < 0 ? a : a.slice(0, eq);
  return KNOWN_FLAGS.has(prefix) ? prefix : null;
}

/** The value of the flag at `i`: after its `=`, or the next word, which the scan then skips. */
function takeValue(argv: string[], i: number, flag: string): FlagValue {
  const a = String(argv[i]);
  if (a === flag) return { value: String(argv[i + 1] || ""), next: i + 1 };
  return { value: a.slice(flag.length + 1), next: i };
}

function toParsed(values: Map<string, string>, glob: string[], unknown: boolean): ParsedArgs {
  const get = (flag: string): string => values.get(flag) ?? "";
  return {
    job: get(JOB_FLAG).trim().toLowerCase(),
    query: get(QUERY_FLAG),
    path: get(PATH_FLAG),
    glob,
    cwd: get(CWD_FLAG),
    stash: get(STASH_FLAG).trim(),
    from: get(FROM_FLAG).trim(),
    to: get(TO_FLAG).trim(),
    unknown,
  };
}

/** The job command line; a stray word or an unknown flag marks it `unknown`. */
export function parseArgv(argv: string[]): ParsedArgs {
  const values = new Map<string, string>();
  const glob: string[] = [];
  let unknown = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = flagOf(String(argv[i]));
    if (!flag) {
      unknown = true;
      continue;
    }
    const taken = takeValue(argv, i, flag);
    i = taken.next;
    if (flag !== GLOB_FLAG) values.set(flag, taken.value);
    else if (taken.value) glob.push(taken.value);
  }
  return toParsed(values, glob, unknown);
}

/** `rel` resolved under `root` (the process cwd when unset), canonical; null when it leaves the root. */
export function resolveUnder(root: string | undefined, rel?: string | null): string | null {
  const base = canonicalPath(path.resolve(root || process.cwd()));
  if (rel == null || rel === "") return base;
  const abs = canonicalPath(path.resolve(base, rel));
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  if (abs !== base && !abs.startsWith(prefix)) return null;
  return abs;
}

/** A job's `--cwd` resolved under the workspace root; null when it leaves it. */
export function resolveJobCwd(cwd: string, workspaceRoot?: string): string | null {
  return resolveUnder(workspaceRoot || process.cwd(), cwd);
}
