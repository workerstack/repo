import { MISTAKES_H2, NONE_LINE, NOT_FOUND } from "./persist-doc.constants.ts";
/** The `## Previous mistakes` log every plan and roadmap ends with, and the review count that gates a status. */
import { hasKey, type FrontmatterMap, type Sections } from "./persist-doc.ts";

/** Entry kinds a plan logs. A roadmap adds its own. */
export const PLAN_MISTAKE_SOURCES: readonly string[] = ["feedback", "verify", "review", "premise", "decision"];

export type MistakeEntry = {
  source: string;
  text: string;
  lesson: string | undefined;
  line: string;
};

const REVIEWS_RE = /^(0|[1-9][0-9]*)$/;

/** Errors when a save removes or lowers the saved review count. */
function keptCountErrors(map: FrontmatterMap, prev: FrontmatterMap | null, count: number): string[] {
  if (!prev || !hasKey(prev, "reviews")) return [];
  if (!hasKey(map, "reviews"))
    return [`keep reviews: ${prev.reviews} in the frontmatter; the review count cannot be removed`];

  return count < Number(prev.reviews) ? [`reviews cannot go down (saved ${prev.reviews}, got ${count})`] : [];
}

/**
 * `reviews` counts settled review rounds: well-formed, never removed or lowered, and gating entry to
 * a status. `gates` maps a status to the rounds it needs; `review` is the command the deny names.
 */
export function reviewErrors(
  map: FrontmatterMap,
  prev: FrontmatterMap | null,
  { gates, review }: { gates: Record<string, number>; review: string },
): string[] {
  const sent = hasKey(map, "reviews");
  if (sent && !REVIEWS_RE.test(String(map.reviews)))
    return ["reviews must be a whole number with no sign or leading zero, e.g. reviews: 1"];

  const count = sent ? Number(map.reviews) : 0;
  const errors = keptCountErrors(map, prev, count);
  const need = map.status === undefined ? undefined : gates[map.status];
  if (need && (!prev || prev.status !== map.status) && count < need) {
    errors.push(
      `status ${map.status} needs reviews: ${need} or more; run ${review}, settle its findings, and bump reviews in that save`,
    );
  }
  return errors;
}

/** `(none)` or one `- {source}: {what was wrong} → {what changed}` line per entry. */
export function parseMistakes(
  sectionText: unknown,
  sources: readonly string[],
): { entries: MistakeEntry[]; errors: string[] } {
  const re = new RegExp(`^- (${sources.join("|")}): (.+?) → (.+?)(?: \\(lesson: ([a-z0-9]+(?:-[a-z0-9]+)*)\\))?$`);
  const lines = String(sectionText ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 1 && lines[0] === NONE_LINE) return { entries: [], errors: [] };
  if (!lines.length) return { entries: [], errors: [`## ${MISTAKES_H2} is empty; write ${NONE_LINE}`] };
  const entries: MistakeEntry[] = [];
  const errors: string[] = [];
  for (const line of lines) {
    const m = line.match(re);
    if (!m) {
      errors.push(
        `Previous mistakes entry must be "- {${sources.join("|")}}: {what was wrong} → {what changed}": ${line}`,
      );
      continue;
    }
    const [, source, was, now, lesson] = m;
    entries.push({ lesson, line, source: String(source), text: `${was} → ${now}` });
  }
  return { entries, errors };
}

/** Errors for entries a saved log had that the new log changed or dropped. */
function appendOnlyErrors(current: MistakeEntry[], previous: Sections, sources: readonly string[]): string[] {
  const kept = current.map((e) => e.line);
  return parseMistakes(previous.bodies[MISTAKES_H2], sources)
    .entries.filter((e, i) => kept[i] !== e.line)
    .map((e) => `Previous mistakes is append-only; keep this entry unchanged: ${e.line}`);
}

/**
 * Errors in a `## Previous mistakes` log given a document's heading order and section bodies:
 * last and once, required when `fresh`, well-formed, and append-only against `previous` (the saved
 * document's order and bodies). `kind` names the document in the deny.
 */
export function mistakeLogErrors(
  order: string[],
  bodies: Record<string, string>,
  {
    fresh,
    previous,
    sources,
    kind,
  }: { fresh: boolean; previous?: Sections | null | undefined; sources: readonly string[]; kind: string },
): string[] {
  const errors: string[] = [];
  const at = order.indexOf(MISTAKES_H2);
  if (at !== NOT_FOUND && (at !== order.length - 1 || order.lastIndexOf(MISTAKES_H2) !== at))
    errors.push("## Previous mistakes must be the last heading, once");

  if (at === NOT_FOUND && fresh) errors.push(`missing ## Previous mistakes; end a new ${kind} with it and (none)`);
  const log = at === NOT_FOUND ? { entries: [], errors: [] } : parseMistakes(bodies[MISTAKES_H2], sources);
  errors.push(...log.errors);
  if (previous?.order.includes(MISTAKES_H2)) errors.push(...appendOnlyErrors(log.entries, previous, sources));
  return errors;
}
