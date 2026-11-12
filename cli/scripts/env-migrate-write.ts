/**
 * How `bun repo env migrate` writes: never over a file with uncommitted changes, so `git restore` always takes a file
 * back to what it was; then each file, parents first, and a fresh child hashes the new files. A difference, a failed
 * read or any throw after the first write restores every file written from memory, and the line ends
 * `; restored <n> files`. A SIGINT or SIGTERM in that window does the same and exits 130 or 143, its line naming the
 * `git restore` that recovers the files should the restore itself not finish.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { childEnv } from "../env.ts";
import { errorMessage } from "../sync-errors.ts";
import { PREFIX, SCOPES, SIGNAL_EXITS, STATUS_WIDTH } from "./env-command.constants.ts";
import { writeAtomic } from "./env-edit.ts";
import { refuse } from "./env-io.ts";
import { hashEnvs, type ParityRun, type ParityTarget, type ViewHashes } from "./env-migrate-parity.ts";
import { plural, type Plan } from "./env-migrate-report.ts";
import { toolEnv } from "./tool-env.ts";

/** What a signal is caught on, and how the process ends after one. */
export type SignalHost = {
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): void;
  off(signal: "SIGINT" | "SIGTERM", listener: () => void): void;
  exit(code: number): void;
};

/** What the migrated files are proved against, and where an interrupt is caught and named. */
export type Proof = {
  readonly targets: readonly ParityTarget[];
  readonly run: ParityRun;
  readonly before: readonly ViewHashes[];
  readonly host: SignalHost;
  readonly stderr: (line: string) => void;
};

/** Refuses when a file of `rels` differs from HEAD, or HEAD lacks it: `git restore` could not take it back. */
export function refuseUncommitted(root: string, rels: readonly string[]): void {
  const status = spawnSync("git", ["status", "--porcelain", "-z", "--", ...rels], {
    cwd: root,
    encoding: "utf8",
    env: toolEnv(childEnv()),
  });

  const [first] = status.stdout.split("\0").filter((entry) => entry !== "");

  if (first !== undefined) refuse(`${first.slice(STATUS_WIDTH)} has uncommitted changes; commit or stash them first`);
}

/** Calls `onSignal` and exits with the signal's code on SIGINT or SIGTERM, until the returned stop is called. */
export function guardSignals(host: SignalHost, onSignal: (signal: string) => void): () => void {
  const stops = SIGNAL_EXITS.map(([signal, code]) => {
    function listener(): void {
      onSignal(signal);
      host.exit(code);
    }

    host.on(signal, listener);

    return () => host.off(signal, listener);
  });

  return () => {
    for (const stop of stops) stop();
  };
}

/** The first key whose hash differs between `before` and `after`, as `<rel> <view>.<KEY>`; undefined when none. */
function firstDifference(proof: Proof, after: readonly ViewHashes[]): string | undefined {
  const differs = proof.targets.flatMap((target, index) =>
    SCOPES.flatMap((view) => {
      const was = { ...proof.before[index]?.[view] };
      const now = { ...after[index]?.[view] };
      const keys = [...new Set([...Object.keys(was), ...Object.keys(now)])];

      return keys.filter((key) => was[key] !== now[key]).map((key) => `${target.rel} ${view}.${key}`);
    }),
  );

  return differs.at(0);
}

/** Writes `plans` in order and proves parity; see the file comment. */
export async function writeAll(root: string, plans: readonly Plan[], proof: Proof): Promise<void> {
  const written: Plan[] = [];
  const recover = `if one still differs, run \`git restore ${plans.map(({ rel }) => rel).join(" ")}\``;

  function restore(): string {
    for (const plan of written) fs.writeFileSync(path.join(root, plan.rel), plan.before);

    return `restored ${plural(written.length, "file")}`;
  }

  const stop = guardSignals(proof.host, (signal) => {
    proof.stderr(`${PREFIX}interrupted by ${signal}; ${restore()}; ${recover}\n`);
  });

  try {
    for (const plan of plans) {
      writeAtomic(plan.rel, path.join(root, plan.rel), plan.migrated.text);
      written.push(plan);
    }

    const after = await hashEnvs(root, proof.targets, proof.run);

    if (!after.ok) refuse(`could not read the migrated files (${after.reason})`);
    const differs = firstDifference(proof, after.hashes);

    if (differs !== undefined) refuse(`${differs} differs after migrate`);
  } catch (error) {
    throw new Error(`${errorMessage(error)}; ${restore()}`, { cause: error });
  } finally {
    stop();
  }
}
