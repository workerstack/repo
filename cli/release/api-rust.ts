import { workspaceCrates, onCratesIo } from "../rust/cargo-metadata.ts";
import { pinProblem } from "../rust/cargo-tools.ts";
import { SEMVER_CHECKS_PIN } from "../rust/cargo-tools.constants.ts";
import type { CargoRun } from "../rust/clippy.ts";
import { STALE_LOCK } from "../rust/lock.constants.ts";
import { AGAINST_NO_PACKAGE, API_PREFIX, NOTHING_TO_COMPARE } from "./api.constants.ts";
import { commitsAfter } from "./git.ts";
import type { Tools } from "./git.ts";
import { isPublicPackage } from "./manifest.ts";
import { refuse } from "./refuse.ts";
import { crateLine } from "./semver-checks.ts";
import type { Line, SemverDeps } from "./semver-checks.ts";

/** Where the Rust part of `repo release api` runs and prints, and the cargo and crates.io index it reads. */
export type RustIo = Tools & {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** The crates.io sparse index. */
  fetch: SemverDeps["fetch"];
  /** The cargo that lists the crates and runs the semver check. */
  cargo: CargoRun;
};

/** Prints a line of the report, each of its lines with the command's prefix: stdout when it passed, else stderr. */
function say(io: RustIo, line: Line): void {
  const text = line.text
    .split("\n")
    .map((part) => `${API_PREFIX}${part}\n`)
    .join("");
  (line.ok ? io.stdout : io.stderr)(text);
}

/** Prints the failure lines; the exit code 1. */
function fail(io: RustIo, lines: readonly string[]): number {
  for (const text of lines) say(io, { ok: false, text });
  return 1;
}

/** The semver check of every crate crates.io may publish: the exit code, or `none` when there is no such crate. */
async function crateChecks(io: RustIo): Promise<number | "none"> {
  const found = workspaceCrates(io.cwd, io.cargo);
  if (found.kind === "stale") return fail(io, [STALE_LOCK]);
  if (found.kind === "failed") return fail(io, found.problems);
  const crates = found.crates.filter(onCratesIo);
  if (crates.length === 0) return "none";
  const pin = pinProblem(io.cwd, io.cargo, SEMVER_CHECKS_PIN);
  if (pin !== null) return fail(io, [pin]);
  const deps: SemverDeps = {
    run: io.cargo,
    fetch: io.fetch,
    git: (after) => commitsAfter(io, after),
  };
  const lines = await Promise.all(crates.map((crate) => crateLine(io.cwd, crate, deps)));
  for (const line of lines) say(io, line);
  return lines.every((line) => line.ok) ? 0 : 1;
}

/**
 * `repo release api` in a repo with a root Cargo.toml: the crates' semver check, then `typescript` for a public package.
 * `--against` is the TypeScript check's, so a repo with no public package refuses it. Any failed part exits 1.
 */
export async function rustApi(
  against: string | undefined,
  io: RustIo,
  typescript: (against: string | undefined) => number,
): Promise<number> {
  const published = isPublicPackage(io.cwd);
  if (against !== undefined && !published) return refuse(io, API_PREFIX, AGAINST_NO_PACKAGE);
  const crates = await crateChecks(io);
  if (crates === "none" && !published) return (io.stdout(`${API_PREFIX}${NOTHING_TO_COMPARE}\n`), 0);
  const ts = published ? typescript(against) : 0;
  return crates === 1 || ts !== 0 ? 1 : 0;
}
