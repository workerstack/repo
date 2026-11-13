#!/usr/bin/env bun
/**
 * Delete scratch under .repo/scratch/ that repo does not own, dead-session state in .repo/tmp/ and stray nested
 * ignored .repo dirs, and age out repo's own files untouched for 30 days (roadmap D12).
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

async function cleanBuildsMain({ deps, dryRun }: { deps: boolean; dryRun: boolean }): Promise<number> {
  const { checkout } = resolveRoots();
  const configured = await configuredNames(checkout);

  if ("errors" in configured) {
    for (const error of configured.errors) emit("error", error);

    return 1;
  }

  return cleanBuilds({ deps, dryRun, names: configured.names, out: (line) => emit("log", line), root: checkout });
}

/** `repo clean`: the ignored `.repo` dirs sweep, or with --build or --deps only the ignored build output. */
export function main(argv: string[]): number | Promise<number> {
  const build = argv.includes(BUILD_FLAG);
  const deps = argv.includes(DEPS_FLAG);
  const dryRun = argv.includes(DRY_RUN_FLAG);

  if (build && deps) {
    emit("error", BOTH_FLAGS);

    return USAGE_EXIT;
  }

  if (build || deps) return cleanBuildsMain({ deps, dryRun });

  return runClean({
    dryRun,
    liveSessions: liveSessions(),
    now: Date.now(),
    out: (line) => emit("log", line),
    root: resolveRoots().root,
  });
}
