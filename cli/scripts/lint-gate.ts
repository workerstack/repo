/**
 * What a baseline gate (`repo lint`, `repo turn`, `repo precommit`) makes of its excesses: those of the files outside
 * the ones it gated, and the lines it prints for them.
 */
import { countsOf, type Counts, type Diagnostic, type Excess, excessText, gate } from "./lint-baseline.ts";

/** What a gate prints of its excesses: the lint lines of each one's rule in its file, then what to do about it. */
type OverOutput = { hits: string[]; fixes: string[] };

/** The lint lines of each excess's rule in its file, then what to do about it, each line named after `command`. */
export function overOutput(command: string, over: readonly Excess[], diagnostics: readonly Diagnostic[]): OverOutput {
  const hits = diagnostics
    .filter((d) => over.some((e) => e.file === d.file && e.rule === d.rule))
    .map((d) => `${d.line}\n`);

  const fixes = over.map((e) => {
    const added = e.has - e.allows;

    return `repo ${command}: ${excessText(e)}; fix the ${added === 1 ? "new one" : `${added} new ones`}\n`;
  });

  return { fixes, hits };
}

/**
 * The excesses of the files outside `linted` whose hits `diagnostics` holds (a guard a changed test re-checked):
 * only their script hits are known, so they can fail a gate but never lower the baseline.
 */
export function outsideOver(baseline: Counts, diagnostics: readonly Diagnostic[], linted: readonly string[]): Excess[] {
  const outside = diagnostics.filter((d) => !linted.includes(d.file));
  const files = [...new Set(outside.map((d) => d.file))];

  return gate(baseline, countsOf(outside), files).over;
}
