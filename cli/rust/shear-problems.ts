import { z } from "zod";

import { SHEAR_MAX_FINDING_EXIT, UNUSED_DEPENDENCY, UNUSED_HELP } from "./cargo-tools.constants.ts";
import { quote } from "./cargo-tools.ts";
import { MISSING_CARGO } from "./clippy.constants.ts";
import type { CargoResult, CargoRun } from "./clippy.ts";

/** The shape of `cargo shear --format=json` this reads, built once per run so the module runs no code. */
function schema() {
  const finding = z.object({
    code: z.string(),
    file: z.string().optional(),
    help: z.string().optional(),
    message: z.string(),
    severity: z.string(),
  });
  return z.object({ findings: z.array(finding) });
}

/** One shear finding as a line; the unused-dependency finding says how to fix it, others carry shear's own help. */
function findingLine(finding: z.infer<ReturnType<typeof schema>>["findings"][number]): string {
  const file = finding.file === undefined ? "" : `${finding.file.replaceAll("\\", "/")}: `;
  const help = finding.code === UNUSED_DEPENDENCY ? UNUSED_HELP : finding.help;
  return `cargo shear: ${file}${finding.message}${help === undefined ? "" : `; ${help}`}`;
}

/** The findings of `result.stdout`, or null when it is not shear's JSON. */
function readShear(result: CargoResult): string[] | null {
  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    return null;
  }
  const body = schema().safeParse(json);
  return body.success ? body.data.findings.map(findingLine) : null;
}

/**
 * The findings of `cargo shear` at `root`. Warnings count as well as errors: shear only warns about real dependency
 * faults. A run that failed (exit 2 or more), printed output repo cannot read, or exited 1 with no finding is a
 * problem.
 */
export function shearProblems(root: string, run: CargoRun): string[] {
  const result = run(root, ["shear", "--locked", "--format=json"]);
  if (result.missing) return [MISSING_CARGO];
  if (result.status === null || result.status > SHEAR_MAX_FINDING_EXIT)
    return [`cargo shear exited ${result.status}${result.stderr.trim() === "" ? "" : `: ${quote(result.stderr)}`}`];

  const lines = readShear(result);
  if (lines === null) return [`cargo shear printed output repo cannot read: ${quote(result.stdout)}`];
  if (lines.length === 0 && result.status !== 0) return [`cargo shear exited ${result.status} and printed no finding`];
  return lines;
}
