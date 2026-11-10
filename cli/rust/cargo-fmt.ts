import { MISSING_CARGO } from "./clippy.constants.ts";
import { runCargo, type CargoRun } from "./clippy.ts";

/** One `cargo fmt` run: `--check` or not, where it prints (a check's diff goes to stdout), and the cargo to run. */
export type FmtJob = {
  check: boolean;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  run?: CargoRun | undefined;
};

/**
 * `cargo fmt --all` in `root`, with `--check` when the job says so, its output passed on; the exit code. Without cargo
 * on PATH it is 1 with the install hint.
 */
export function cargoFmt(root: string, job: FmtJob): number {
  const { check, stdout, stderr, run = runCargo } = job;
  const result = run(root, check ? ["fmt", "--all", "--check"] : ["fmt", "--all"]);
  if (result.missing) {
    stderr(`repo fmt: ${MISSING_CARGO}\n`);
    return 1;
  }
  stdout(result.stdout);
  stderr(result.stderr);
  return result.status ?? 1;
}
