import type { loadConfig } from "./config.ts";
import { parseMode, syncOnce } from "./sync-once.ts";
import type { PostPass } from "./sync/git-files.ts";
import type { Generator, Output } from "./sync/outputs.ts";
import type { GitRun } from "./sync/standards.ts";
import type { FormatEntry } from "./sync/validate.ts";

/** Where repo sync prints; each call gets whole lines. */
export type SyncIo = { cwd: string; stdout: (s: string) => void; stderr: (s: string) => void };

/**
 * Seams for tests: the generators to run, the config reader, the output formats to validate against, the platform
 * links are made for, and how one output is written.
 */
export type SyncDeps = {
  generators?: readonly Generator[];
  /**
   * Run in order over the generators' outputs, each also seeing the outputs of those before it; `POST_PASSES` when
   * omitted.
   */
  post?: readonly PostPass[];
  formats?: readonly FormatEntry[];
  /** Reads the config; `loadConfig` when omitted. */
  load?: typeof loadConfig;
  platform?: NodeJS.Platform;
  writeOutput?: (root: string, output: Output, platform: NodeJS.Platform) => string | null;
  /** Runs git for the `core.hooksPath` step and the header prune; `runGit` and a `GIT_*`-free git when omitted. */
  git?: GitRun;
  /**
   * Puts the recorded links back after an install, from the directory sync ran in; `repo link`'s reapply when omitted.
   */
  reapply?: (cwd: string, io: SyncIo) => Promise<void> | void;
};

/** The default reapply, loaded only when an install asks for it. */
async function reapplyLinks(cwd: string, io: SyncIo): Promise<void> {
  const { reapplyAt } = await import("./link-reapply.ts");
  await reapplyAt(cwd, io);
}

/**
 * `repo sync [--check | --postinstall]`: validates the config and every output, writes the outputs that changed,
 * removes what the last run wrote or a tracked file with sync's header that no output names now, then records every
 * output path in the manifest. Every run that writes leaves each whole file output read-only again, changed or not.
 * `--check` writes nothing and fails on drift, which a mode never is; `--postinstall` reports errors but exits 0.
 */
export async function runSync(args: string[], io: SyncIo, deps: SyncDeps = {}): Promise<number> {
  const code = await syncOnce(args, io, deps);
  // An install replaced the swapped packages with npm's copies; whatever sync said, they go back.
  const parsed = parseMode(args);
  if (parsed.ok && parsed.mode.postinstall) await (deps.reapply ?? reapplyLinks)(io.cwd, io);
  return code;
}
