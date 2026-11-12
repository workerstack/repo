import {
  BOX_RE,
  FILE_SPLIT_RE,
  LEAF_ID_RE,
  PARALLEL_RE,
  PHASE_ID_RE,
  PRINCIPLE_READ_RE,
} from "./persist-plan.constants.ts";
/** The checkbox lines of a plan: boxes, phases, `(parallel: …)` groups and the read-only phase check. */
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

/** The files a `(parallel: a, b)` phase declares, `\` read as `/`, as written; null when not parallel. */
export function parallelFiles(phase: PlanBox): string[] | null {
  const m = PARALLEL_RE.exec(phase.text) /* the pattern names its group */ as
    | (RegExpExecArray & { groups: { files: string } })
    | null;

  if (m === null) return null;

  return m.groups.files
    .split(FILE_SPLIT_RE)
    .filter(Boolean)
    .map((f) => f.replaceAll("\\", "/"));
}

type Member = {
  id: string;
  files: string[];
};

/** Runs of adjacent `parallel:` phases. */
function parallelGroups(phases: PlanPhase[]): Member[][] {
  const groups: Member[][] = [];
  let run: Member[] = [];

  for (const p of [...phases, null]) {
    const files = p === null ? null : parallelFiles(p);

    if (p !== null && files !== null) {
      run.push({ files, id: p.id });
      continue;
    }

    if (run.length > 0) groups.push(run);
    run = [];
  }

  return groups;
}

function sharedFileErrors(a: Member, b: Member): string[] {
  const shared = new Set(a.files.filter((x) => b.files.includes(x)));

  return [...shared].map(
    (f) => `parallel phases ${a.id} and ${b.id} both list ${f}; parallel phases need disjoint files`,
  );
}

function groupErrors(group: Member[]): string[] {
  return group.flatMap((a, i) => [
    ...(group.length === 1 ? [`phase ${a.id} is parallel alone; parallel needs two or more adjacent phases`] : []),
    ...(a.files.length > 0
      ? []
      : [`phase ${a.id} is parallel with no files; list the files it writes after parallel:`]),
    ...group.slice(i + 1).flatMap((b) => sharedFileErrors(a, b)),
  ]);
}

/**
 * Adjacent `parallel:` phases form a group that may run at once, so their declared files must be
 * disjoint. A group needs two or more phases, and each phase must declare its files.
 */
export function parallelErrors(phases: PlanPhase[]): string[] {
  return parallelGroups(phases).flatMap(groupErrors);
}
