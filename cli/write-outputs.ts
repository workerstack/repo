import { fail } from "./sync-errors.ts";
import type { Run } from "./sync-once.ts";
import { isCurrentOutput } from "./sync-outputs.ts";
import { SYNC_PREFIX } from "./sync.constants.ts";
import { headerStale } from "./sync/header-stale.ts";
import { prunePaths, readManifest, renderManifest } from "./sync/manifest.ts";
import type { Output } from "./sync/outputs.ts";
import { applyCuts, type Cut, cutDriftLines, repairLines, splitPrune } from "./sync/prune-shared.ts";
import { markHooksExecutable, syncHooksPath } from "./sync/standards.ts";
import { settleModes } from "./sync/write-modes.ts";
import { writeAll } from "./sync/write.ts";

/** What a run changes on disk: the outputs to write, the files to remove and the shared files to cut. */
type Changes = { changed: Output[]; prune: string[]; cut: Cut[] };

/** Path list for the summary line: outputs sharing a top dir collapse to `dir/ (n)`, single files keep their name. */
const top = (rel: string): string | null => (rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : null);

function summarize(paths: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const rel of paths) {
    const dir = top(rel);
    if (dir !== null) counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const rel of paths) {
    const dir = top(rel);
    if (dir === null || counts.get(dir) === 1) {
      parts.push(rel);
    } else if (!seen.has(dir)) {
      parts.push(`${dir}/ (${counts.get(dir)})`);
      seen.add(dir);
    }
  }
  return parts.join(", ");
}

/** The outputs not on disk as planned, and what the last run here or an older version wrote that no output names. */
function changesOf(run: Run): Changes {
  const { root, outputs, deps } = run;
  const platform = deps.platform ?? process.platform;
  const changed = outputs.filter((output) => !isCurrentOutput(root, output, platform));
  // The manifest names what the last run here wrote; the header finds what an older version wrote in any checkout.
  const stale = prunePaths(
    readManifest(root),
    outputs.map((output) => output.path),
    root,
  );
  // A shared file no output writes any more is cut, not deleted: the user's lines in it stay.
  const { cut, remove: prune } = splitPrune(root, [...stale, ...headerStale(root, outputs, deps.git)]);
  return { changed, cut, prune };
}

/** `--check`: each drift on stderr; 0 when there is none. */
function reportDrift(run: Run, { changed, prune, cut }: Changes): number {
  const { io } = run;
  for (const output of changed) io.stderr(`${SYNC_PREFIX}${output.path} is out of date; run \`bun repo sync\`\n`);
  for (const rel of prune) io.stderr(`${SYNC_PREFIX}${rel} is stale and would be removed; run \`bun repo sync\`\n`);
  for (const line of cutDriftLines(cut)) io.stderr(`${SYNC_PREFIX}${line}\n`);
  const current = changed.length === 0 && prune.length === 0 && cut.length === 0;
  if (current) io.stdout(`${SYNC_PREFIX}up to date\n`);
  return current ? 0 : 1;
}

/** The summary line's parts for what was written, removed and cut. */
function summaryParts({ changed, prune, cut }: Changes): string[] {
  const parts = [];
  if (changed.length > 0) parts.push(`wrote ${summarize(changed.map((output) => output.path))}`);
  if (prune.length > 0) parts.push(`removed ${summarize(prune)}`);
  if (cut.length > 0) parts.push(`cut ${summarize(cut.map((entry) => entry.path))}`);
  return parts;
}

/** Machine state, not repo content, so `--check` never sets it: the hooks path and the hooks' execute bits. */
function setUpHooks(run: Run): { done: string[]; warnings: string[] } {
  const { root, deps } = run;
  const standards = run.resolved.packs.includes("standards");
  const hooks = syncHooksPath(root, standards, deps.git);
  const platform = deps.platform ?? process.platform;
  const modes = standards ? markHooksExecutable(root, platform, deps.git) : { done: [], warnings: [] };
  return { done: [...hooks.done, ...modes.done], warnings: [...hooks.warnings, ...modes.warnings] };
}

/** Writes the changes, then the manifest and the hooks, and prints the summary line; the exit code. */
function writeChanges(run: Run, changes: Changes): number {
  const { root, io, outputs, deps } = run;
  const platform = deps.platform ?? process.platform;
  const write = { platform, writeOutput: deps.writeOutput };
  // Cut first, so a cut that fails leaves the manifest naming the file for the next run.
  const cuts = applyCuts(root, changes.cut, write);
  for (const line of cuts.lines) io.stderr(`${SYNC_PREFIX}${line}\n`);
  if (cuts.errors.length > 0) return fail(run, cuts.errors);
  const manifest = renderManifest(outputs.map((output) => output.path));
  const written = writeAll(root, { changed: changes.changed, manifest, prune: changes.prune }, write);
  if (!written.ok) return fail(run, written.refused ? [...written.errors, "nothing written"] : written.errors);
  // Git keeps no read-only bit, so a checkout leaves a current output writable; a warning, since its bytes are right.
  const locks = settleModes(root, outputs, platform);
  const hooks = setUpHooks(run);
  const parts = [...summaryParts(changes), ...hooks.done];
  for (const warning of [...locks, ...hooks.warnings]) io.stderr(`${SYNC_PREFIX}${warning}\n`);
  io.stdout(`${SYNC_PREFIX}${parts.length === 0 ? "up to date" : parts.join("; ")}\n`);
  return 0;
}

/** The planned outputs onto disk, or with `--check` the drift from them; the exit code. */
export function writeOutputs(run: Run): number {
  for (const line of repairLines(run.outputs)) run.io.stderr(`${SYNC_PREFIX}${line}\n`);
  const changes = changesOf(run);
  return run.check ? reportDrift(run, changes) : writeChanges(run, changes);
}
