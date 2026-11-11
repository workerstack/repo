/** `repo clean`'s sweep: plan, delete unless a dry run, and the report lines. */
import fs from "node:fs";
import path from "node:path";
import { boardHome, readBootId, sweep } from "./board.ts";
import {
  DURABLE,
  GB,
  KB,
  KEEP_ORDER,
  KEEP_PLURAL,
  MB,
  NESTED_KIND,
  PLURAL,
  REMOVE_ORDER,
  RM_RETRIES,
} from "./clean.constants.ts";
import { cleanPlan } from "./clean-plan.ts";
import { nestedTmpDirs, stats } from "./clean-scan.ts";
import type { CleanRun, KeepItem, RemoveItem } from "./clean.types.ts";
import { TMP_DIR } from "./persist-tmp.ts";
import { readEnv } from "../env.ts";
import type { Env } from "../env.ts";

/** "n kind" for each kind in `order` that `items` hold, plural past one. */
function counted(
  items: { kind: string }[],
  order: readonly string[],
  plural: Readonly<Record<string, string>>,
): string[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) || 0) + 1);
  return order
    .filter((k) => counts.get(k))
    .map(
      (k) =>
        `${counts.get(k)} ${counts.get(k) === 1 ? k : (plural[k] /* every ordered kind has a plural */ as string)}`,
    );
}

/** `bytes` as B, KB, MB or GB with one decimal. */
export function size(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= KB) return `${(bytes / KB).toFixed(1)} KB`;
  return `${bytes} B`;
}

function keptLine(keep: KeepItem[]): string {
  const durable = DURABLE.filter((d) => keep.some((k) => k.kind === d));
  const rest = counted(keep, KEEP_ORDER, KEEP_PLURAL);
  return [...durable, ...rest].join(", ") || "nothing";
}

/** Removes each planned path unless a dry run; returns what went, its bytes and how many failed. */
function removeAll(
  run: CleanRun,
  remove: RemoveItem[],
  relOf: (p: string) => string,
): { done: RemoveItem[]; bytes: number; failed: number } {
  const { dryRun, out, rm = fs.rmSync } = run;
  const done: RemoveItem[] = [];
  let failed = 0;
  let bytes = 0;
  for (const item of remove) {
    const b = stats(item.path).bytes;
    if (dryRun) {
      out(relOf(item.path));
    } else {
      try {
        rm(item.path, { recursive: true, force: true, maxRetries: RM_RETRIES });
      } catch (err) {
        failed += 1;
        out(
          `skipped ${relOf(item.path)}: ${(err /* rm throws an fs error that carries a code */ as NodeJS.ErrnoException).code}`,
        );
        continue;
      }
    }
    done.push(item);
    bytes += b;
  }
  return { done, bytes, failed };
}

/** Plan, delete unless dryRun, report through `out`; returns the exit code. */
export function runClean(run: CleanRun): number {
  const { root, now, dryRun, out } = run;
  const relOf = (p: string): string => path.relative(root, p).split(path.sep).join("/");
  const { remove, keep } = cleanPlan({ root, now, liveSessions: run.liveSessions, nested: nestedTmpDirs(root) });
  const { done, bytes, failed } = removeAll(run, remove, relOf);
  const verb = dryRun ? "would remove" : "removed";
  const parts = counted(done, REMOVE_ORDER, PLURAL);
  out(
    parts.length
      ? `${verb} ${parts.join(", ")} (${size(bytes)})`
      : `${verb} 0 entries from ${relOf(path.join(root, TMP_DIR))}`,
  );
  out(`${dryRun ? "would keep" : "kept"} ${keptLine(keep)}`);
  for (const item of keep.filter((k) => k.kind === NESTED_KIND))
    out(`kept nested ${relOf(item.path)}: holds ${item.holds}`);
  return failed ? 1 : 0;
}

/** Session ids with a live host process on this machine's board. */
export function liveSessions(env: Env = readEnv()): Set<string> {
  return new Set(sweep({ home: boardHome(env), boot: readBootId() }).map((row) => row.session));
}
