/** `repo setup` argv: positionals, `--flag value` and `--flag=value` pairs, and the target a name stands for. */
import { FLAG_ON, FLAG_PREFIX, FLAG_TRUE, GOOGLE_ALIASES, TARGETS } from "./setup.constants.ts";
import type { Flags } from "./setup.types.ts";

export function parseArgv(argv: unknown): { _: string[]; flags: Flags } {
  const out: { _: string[]; flags: Flags } = { _: [], flags: {} };
  const args: unknown[] = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === FLAG_PREFIX) {
      out._.push(...args.slice(i + 1).map(String));
      break;
    }
    if (typeof a === "string" && a.startsWith(FLAG_PREFIX)) {
      const eq = a.indexOf("=");
      if (eq > FLAG_PREFIX.length) {
        out.flags[a.slice(FLAG_PREFIX.length, eq)] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(FLAG_PREFIX.length);
      const nxt = args[i + 1];
      if (nxt && !String(nxt).startsWith(FLAG_PREFIX)) {
        out.flags[key] = String(nxt);
        i += 1;
      } else {
        out.flags[key] = FLAG_ON;
      }
    } else {
      out._.push(String(a));
    }
  }
  return out;
}

export function normalizeTarget(raw: unknown): string {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (!s) return "";
  if (GOOGLE_ALIASES.includes(s)) return "google-workspace";

  if (TARGETS.includes(s)) return s;
  return "";
}

/** Whether `flags[key]` is set to "1" or "true". */
export function flagOn(flags: Flags | undefined, key: string): boolean {
  const v = flags?.[key];
  return v !== undefined && FLAG_TRUE.includes(v);
}
