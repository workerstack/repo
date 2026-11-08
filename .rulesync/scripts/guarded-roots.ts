#!/usr/bin/env bun
/** Snapshot/remerge AGENTS.md around generate/check/watch. */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  GUARDED_ROOT_FILES,
  type GuardedRootSnapshot,
  healGuardedRootFile,
  remergeGuardedRoots,
  snapshotGuardedRoots,
  withGuardedCheckInteriors,
} from "./guarded-md.ts";
import { defaultExec, runPipeline, type ExecFn } from "./pipeline.ts";

export function attachGuardedRootWatchers(cwd: string, heal: (file: string) => void): () => void {
  const w = fs.watch(cwd, (_event: string, filename: string | null) => {
    if (!filename) return;
    const base = path.basename(String(filename));
    if (!GUARDED_ROOT_FILES.includes(base)) return;
    heal(base);
  });
  return () => {
    try {
      w.close();
    } catch {
      /* ignore */
    }
  };
}

interface GuardedRootsOptions {
  cwd?: string;
  exec?: ExecFn;
  attachWatchers?: (args: { cwd: string; snap: GuardedRootSnapshot; heal: (file: string) => void; }) => (() => void) | void;
}

/**
 * Run the generate, check, or watch pipeline around the guarded root files.
 * @param mode "generate" | "check" | "watch"; anything else throws.
 * @param [options]
 * @returns
 */
export function runGuardedRoots(mode: string, { cwd = process.cwd(), exec = defaultExec, attachWatchers }: GuardedRootsOptions = {}): void {
  if (mode === "generate") {
    const snap = snapshotGuardedRoots(cwd);
    try {
      runPipeline("generate", { cwd, exec });
    } finally {
      remergeGuardedRoots(cwd, snap);
    }
    return;
  }
  if (mode === "check") {
    withGuardedCheckInteriors(cwd, () => {
      runPipeline("check", { cwd, exec });
    });
    return;
  }
  if (mode === "watch") {
    const snap = snapshotGuardedRoots(cwd);
    const heal = (file: string) => healGuardedRootFile(cwd, file, snap);
    const attach = attachWatchers || ((opts: { cwd: string; heal: (file: string) => void }) => attachGuardedRootWatchers(opts.cwd, opts.heal));
    const stop = attach({ cwd, snap, heal });
    try {
      runPipeline("watch", { cwd, exec });
    } finally {
      try {
        stop?.();
      } catch {
        /* ignore */
      }
      remergeGuardedRoots(cwd, snap);
    }
    return;
  }
  throw new Error("usage: guarded-roots.ts generate|check|watch");
}

function main() {
  try {
    runGuardedRoots(process.argv[2] || "");
    return 0;
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n");
    return 1;
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile) process.exit(main());
