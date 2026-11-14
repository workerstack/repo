import { globToRegExp } from "./lesson-file.ts";
/**
 * `(parallel: …)` groups on plan phases, fast plan steps and roadmap slices: the marker's entries and the checks a
 * group must pass. An entry is a file, a folder ending `/`, or a glob; two entries overlap when one
 * path could match both.
 */
import { ANY_DEPTH, FILE_SPLIT_RE, GLOB_SEGMENT_RE, PARALLEL_RE } from "./parallel-groups.constants.ts";

type MarkerMatch = RegExpExecArray & { groups: { files: string } };

/** The entries a `(parallel: a, b)` line ends with, `\` read as `/`; null when the line has no marker. */
export function parallelList(text: string): string[] | null {
  const m = PARALLEL_RE.exec(text) /* the pattern names its group */ as MarkerMatch | null;

  if (m === null) return null;

  return m.groups.files
    .split(FILE_SPLIT_RE)
    .filter(Boolean)
    .map((f) => f.replaceAll("\\", "/"));
}

/** The line without its trailing marker. */
export function withoutParallel(text: string): string {
  return text.replace(PARALLEL_RE, "");
}

/** An entry's segments; a folder (`a/`) reaches every path under it. */
function segments(entry: string): string[] {
  const parts = entry.split("/").filter(Boolean);

  return entry.endsWith("/") ? [...parts, ANY_DEPTH] : parts;
}

function segmentsMeet(a: string, b: string): boolean {
  const globA = GLOB_SEGMENT_RE.test(a);
  const globB = GLOB_SEGMENT_RE.test(b);

  if (!globA && !globB) return a === b;

  return globA ? globB || globToRegExp(a).test(b) : globToRegExp(b).test(a);
}

/** Whether some path matches both segment lists. */
function meet(a: readonly string[], b: readonly string[]): boolean {
  const [x, ...restA] = a;
  const [y, ...restB] = b;

  if (x === ANY_DEPTH) return meet(restA, b) || (y !== undefined && meet(a, restB));

  if (y === ANY_DEPTH) return meet(a, restB) || (x !== undefined && meet(restA, b));

  if (x === undefined || y === undefined) return x === y;

  return segmentsMeet(x, y) && meet(restA, restB);
}

function overlap(a: string, b: string): boolean {
  return meet(segments(a), segments(b));
}

/** Whether `entry` (a file, folder or glob) holds the changed file `file`. */
export function owns(entry: string, file: string): boolean {
  return overlap(entry, file.replaceAll("\\", "/"));
}

type Member = {
  id: string;
  files: string[] | null;
};

type Group = {
  id: string;
  files: string[];
}[];

const WORDS = {
  phase: { items: "files", list: "list the files it writes after parallel:" },
  slice: { items: "paths", list: "list the paths it changes after parallel:" },
  step: { items: "files", list: "list the files it writes after parallel:" },
} as const;

type Kind = keyof typeof WORDS;

/** Runs of adjacent members that carry the marker. */
function groupsOf(members: readonly Member[]): Group[] {
  const groups: Group[] = [];
  let run: Group = [];

  for (const m of [...members, null]) {
    if (m !== null && m.files !== null) {
      run.push({ files: m.files, id: m.id });
      continue;
    }

    if (run.length > 0) groups.push(run);
    run = [];
  }

  return groups;
}

function pairErrors(a: Group[number], b: Group[number], kind: Kind): string[] {
  const tail = `parallel ${kind}s need disjoint ${WORDS[kind].items}`;
  const both = new Set(a.files.filter((f) => b.files.includes(f)));
  const nested = a.files.flatMap((f) => b.files.filter((g) => f !== g && overlap(f, g)).map((g) => [f, g] as const));

  return [
    ...[...both].map((f) => `parallel ${kind}s ${a.id} and ${b.id} both list ${f}; ${tail}`),
    ...nested.map(([f, g]) => `parallel ${kind}s ${a.id} and ${b.id} overlap at ${f} and ${g}; ${tail}`),
  ];
}

function groupErrors(group: Group, kind: Kind): string[] {
  return group.flatMap((a, i) => [
    ...(group.length === 1 ? [`${kind} ${a.id} is parallel alone; parallel needs two or more adjacent ${kind}s`] : []),
    ...(a.files.length > 0 ? [] : [`${kind} ${a.id} is parallel with no ${WORDS[kind].items}; ${WORDS[kind].list}`]),
    ...group.slice(i + 1).flatMap((b) => pairErrors(a, b, kind)),
  ]);
}

/**
 * Adjacent marked phases, steps or slices form a group that may run at once, so their entries must not
 * overlap. A group needs two or more members, and each member must list what it writes.
 */
export function parallelGroupErrors(members: readonly Member[], kind: Kind): string[] {
  return groupsOf(members).flatMap((g) => groupErrors(g, kind));
}
