import type { Assessed } from "./update-plan.ts";
import { isMajor } from "./update-spec.ts";
import {
  ARROW,
  COLUMN_GAP,
  FOLLOW_UP,
  INDENT,
  MAJOR_MARK,
  WHERE_MIN,
  allCurrent,
  behindHeader,
  skippedLine,
  updatedHeader,
} from "./update.constants.ts";
import type { Checked } from "./update.types.ts";

function change(source: Checked): string {
  return `${source.prefix}${source.version} ${ARROW} ${source.prefix}${source.latest}`;
}

/** The lines `--check` prints: the table of what is behind, or that all is current, then what was skipped. */
export function checkLines({ checked, behind, skipped }: Assessed): string[] {
  const skips = skipped.length > 0 ? [skippedLine(skipped)] : [];
  if (behind.length === 0) return [allCurrent(checked.length), ...skips];
  const nameWidth = Math.max(...behind.map((source) => source.name.length)) + COLUMN_GAP;
  const whereWidth = Math.max(WHERE_MIN, ...behind.map((source) => source.where.length + COLUMN_GAP));
  const rows = behind.map((source) => {
    const major = isMajor(source.version, source.latest) ? `${INDENT}${MAJOR_MARK}` : "";
    return `${INDENT}${source.name.padEnd(nameWidth)}${source.where.padEnd(whereWidth)}${change(source)}${major}`;
  });
  return [behindHeader(behind.length, checked.length), ...rows, ...skips, FOLLOW_UP];
}

/** The one line `update` prints after it writes: each change with where it was made. */
export function updatedLine(behind: readonly Checked[]): string {
  const parts = behind.map((source) => `${source.name} ${change(source)} in ${source.said}`);
  return `${updatedHeader(behind.length)}${parts.join(", ")}`;
}
