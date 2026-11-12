/**
 * The rejections step of `repo turn`: every reject file of each package the change set touches, since a change to a
 * source can widen a type its reject files test. Absent when those packages hold none.
 */
import { sourceFiles } from "../check-comments.ts";
import { rejectionProblems } from "../check-rejections.ts";
import { ownerOf } from "./change-set.ts";
import { failed, owners, passed, type StepResult, type Turn } from "./turn-steps.ts";

const REJECT_FILE = /\.reject\.tsx?$/;

/** The reject files of the touched packages, or why they could not be listed. */
function rejectFiles(root: string, packages: readonly string[], touched: readonly string[]) {
  const listed = sourceFiles(root);

  if (!listed.ok) return listed;
  const files = listed.files.filter((rel) => REJECT_FILE.test(rel) && touched.includes(ownerOf(rel, packages)));

  return { files, ok: true as const };
}

/** `rejections ok`, or `rejections N failed` naming the failing files' count, each problem printed. */
export function rejectionsStep(turn: Turn): StepResult | null {
  const listed = rejectFiles(turn.root, turn.packages, owners(turn));

  if (!listed.ok) {
    return failed(
      "rejections failed",
      listed.errors.map((line) => `repo turn: ${line}\n`),
    );
  }

  if (listed.files.length === 0) return null;
  const problems = rejectionProblems(turn.root, listed.files);

  if (problems.length === 0) return passed("rejections ok");
  const failing = listed.files.filter((rel) => problems.some((line) => line.startsWith(`${rel}: `)));
  const label = failing.length === 0 ? "rejections failed" : `rejections ${failing.length} failed`;

  return failed(
    label,
    problems.map((line) => `repo turn: rejections: ${line}\n`),
  );
}
