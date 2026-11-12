/** `repo setup` argv: positionals, `--flag value` and `--flag=value` pairs, and the target a name stands for. */
import { FLAG_ON, FLAG_PREFIX, FLAG_TRUE, GOOGLE_ALIASES, TARGETS } from "./setup.constants.ts";
import type { Flags } from "./setup.types.ts";
import { str } from "./voice-args.ts";

/** Records the flag `a` in `flags`; true when it took `next` as its value. */
function takeFlag(flags: Flags, a: string, next: string | undefined): boolean {
  const eq = a.indexOf("=");

  if (eq > FLAG_PREFIX.length) {
    flags[a.slice(FLAG_PREFIX.length, eq)] = a.slice(eq + 1);

    return false;
  }

  const key = a.slice(FLAG_PREFIX.length);

  if (next !== undefined && next !== "" && !next.startsWith(FLAG_PREFIX)) {
    flags[key] = next;

    return true;
  }

  flags[key] = FLAG_ON;

  return false;
}

export function parseArgv(argv: readonly string[]): { _: string[]; flags: Flags } {
  const out: { _: string[]; flags: Flags } = { _: [], flags: {} };
  let isValue = false;

  for (const [i, a] of argv.entries()) {
    if (isValue) {
      isValue = false;
      continue;
    }

    if (a === FLAG_PREFIX) {
      out._.push(...argv.slice(i + 1));
      break;
    }

    if (a.startsWith(FLAG_PREFIX)) isValue = takeFlag(out.flags, a, argv[i + 1]);
    else out._.push(a);
  }

  return out;
}

export function normalizeTarget(raw: string | undefined): string {
  const s = str(raw).toLowerCase();

  if (s === "") return "";

  if (GOOGLE_ALIASES.includes(s)) return "google-workspace";

  if (TARGETS.includes(s)) return s;

  return "";
}

/** Whether `flags[key]` is set to "1" or "true". */
export function flagOn(flags: Flags | undefined, key: string): boolean {
  const v = flags?.[key];

  return v !== undefined && FLAG_TRUE.includes(v);
}
