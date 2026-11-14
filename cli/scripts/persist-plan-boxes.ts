/** The checkbox lines of a plan: boxes, phases, `(parallel: …)` groups and the read-only phase check. */
import { parallelGroupErrors, parallelList } from "./parallel-groups.ts";
import { BOX_RE, LEAF_ID_RE, PHASE_ID_RE, PRINCIPLE_READ_RE } from "./persist-plan.constants.ts";
import { fencedLineSet } from "./persist-sections.ts";

export type PlanBox = {
  id: string;
  mark: string;
  text: string;
};

export type PlanPhase = {
  leaves: PlanBox[];
} & PlanBox;

type BoxMatch = RegExpExecArray & { groups: PlanBox };

/** Checkbox lines outside code fences, in file order. */
export function planBoxes(text: string): PlanBox[] {
  const lines = text.split("\n");
  const { fenced } = fencedLineSet(lines);
  const boxes: PlanBox[] = [];

  for (const [i, line] of lines.entries()) {
    // The pattern names every group, so a match always sets them.
    const m = fenced.has(i) ? null : (BOX_RE.exec(line) /* the pattern names every group */ as BoxMatch | null);

    if (m !== null) boxes.push({ id: m.groups.id, mark: m.groups.mark, text: m.groups.text });
  }

  return boxes;
}

/** Phases (`N [ ]`) in order, each with the leaves under it. */
export function planPhases(boxes: PlanBox[]): PlanPhase[] {
  return boxes
    .filter((b) => PHASE_ID_RE.test(b.id))
    .map((p) => ({ ...p, leaves: boxes.filter((b) => LEAF_ID_RE.test(b.id) && b.id.startsWith(`${p.id}.`)) }));
}

function readsOnly(phase: PlanPhase) {
  return phase.leaves.length > 0 && phase.leaves.every((l) => PRINCIPLE_READ_RE.test(l.text.trim()));
}

/**
 * A phase that only reads principles gates nothing: each read belongs in the phase it gates. A
 * fresh save is denied; an update only when the saved file had no such phase.
 */
export function readPhaseErrors(
  phases: PlanPhase[],
  { fresh, previous }: { fresh: boolean; previous?: string | null | undefined },
): string[] {
  const offending = phases.filter(readsOnly);

  if (offending.length === 0) return [];

  if (!fresh && previous != null && planPhases(planBoxes(previous)).some(readsOnly)) return [];

  return offending.map((p) => `phase ${p.id} only reads principles; move each read into the phase it gates`);
}

/** The entries a `(parallel: a, b)` phase declares, `\` read as `/`; null when not parallel. */
export function parallelFiles(phase: PlanBox): string[] | null {
  return parallelList(phase.text);
}

/**
 * Adjacent `parallel:` phases form a group that may run at once, so their declared entries must not
 * overlap. A group needs two or more phases, and each phase must declare its files.
 */
export function parallelErrors(phases: PlanPhase[]): string[] {
  return parallelGroupErrors(
    phases.map((p) => ({ files: parallelFiles(p), id: p.id })),
    "phase",
  );
}
