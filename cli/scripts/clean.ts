#!/usr/bin/env bun
/**
 * Delete scratch under .tmp/repo/ that repo does not own, dead-session state and stray nested .tmp/repo dirs,
 * and age out repo's own files untouched for 30 days (roadmap D12).
 */
import { BOTH_FLAGS } from "./build-dirs.constants.ts";
import { cleanBuilds, configuredNames } from "./clean-builds.ts";
import { liveSessions, runClean } from "./clean-run.ts";
import { BUILD_FLAG, DEPS_FLAG, DRY_RUN_FLAG, USAGE_EXIT } from "./clean.constants.ts";
import { resolveRoots } from "./workspace-root.ts";

/** Writes one line to stdout, or to stderr for "error". */
function emit(stream: "log" | "error", line: string): void {
  console[stream](line);
}

async function cleanBuildsMain(deps: boolean, dryRun: boolean): Promise<number> {
  const { checkout } = resolveRoots();
  const configured = await configuredNames(checkout);
  if ("errors" in configured) {
    for (const error of configured.errors) emit("error", error);
    return 1;
  }
  return cleanBuilds({ deps, dryRun, names: configured.names, out: (line) => emit("log", line), root: checkout });
}

/** `repo clean`: the .tmp/repo sweep, or with --build or --deps only the ignored build output. */
export function main(argv: string[]): number | Promise<number> {
  const [build, deps, dryRun] = [BUILD_FLAG, DEPS_FLAG, DRY_RUN_FLAG].map((flag) => argv.includes(flag));
  if (build && deps) {
    emit("error", BOTH_FLAGS);
    return USAGE_EXIT;
  }
  if (build || deps) return cleanBuildsMain(Boolean(deps), Boolean(dryRun));
  return runClean({
    dryRun: Boolean(dryRun),
    liveSessions: liveSessions(),
    now: Date.now(),
    out: (line) => emit("log", line),
    root: resolveRoots().root,
  });
}
