import { FENCE, HEADING, UNRELEASED, VERSION_HASHES, VERSION_HEADING } from "./release.constants.ts";
import type { Parts } from "./version.ts";

const TRAILING_NEWLINE = /\n$/;
const EDGE_NEWLINES = /^\n+|\n+$/g;

/** A `##` (version) or `###` (section) heading outside a code fence: its 0-based line and the text after the hashes. */
export type Heading = { at: number; kind: "version" | "section"; text: string };
/** A `##` section: its heading line, the version in it (null when it names none) and the lines below. */
export type Section = { heading: string; version: string | null; body: string[] };
/** The text before the first section, and each section in file order. */
export type Parsed = { preamble: string[]; sections: Section[] };

/** The lines of a file, without the newline that ends it. */
export function linesOf(text: string): string[] {
  return text.replace(TRAILING_NEWLINE, "").split("\n");
}

/** Every heading of `lines` that is not inside a fenced code block. */
export function headings(lines: readonly string[]): Heading[] {
  let isFenced = false;
  const found: Heading[] = [];
  for (const [at, line] of lines.entries()) {
    if (line.startsWith(FENCE)) isFenced = !isFenced;
    const [, hashes, text] = (isFenced ? null : HEADING.exec(line)) ?? [];
    if (text !== undefined) found.push({ at, kind: hashes === VERSION_HASHES ? "version" : "section", text });
  }
  return found;
}

/** Splits a changelog at its `##` headings. */
export function parseChangelog(text: string): Parsed {
  const lines = linesOf(text);
  const starts = headings(lines).filter((heading) => heading.kind === "version");
  const first = starts[0]?.at ?? lines.length;
  const sections = starts.map(({ at, text: heading }, i) => ({
    body: lines.slice(at + 1, starts[i + 1]?.at ?? lines.length),
    heading: `${VERSION_HASHES} ${heading}`,
    version: VERSION_HEADING.exec(heading)?.[1] ?? null,
  }));
  return { preamble: lines.slice(0, first), sections };
}

/** The `##` section of `version` in a changelog's text; null when it has none. */
export function sectionFor(text: string, version: string): Section | null {
  return parseChangelog(text).sections.find((section) => section.version === version) ?? null;
}

/** The `###` groups of a section body, in order: the loose text before the first has the name "". */
export function groupsOf(body: readonly string[]): [string, string[]][] {
  let current: [string, string[]] = ["", []];
  const groups = [current];
  const starts = new Map(
    headings(body)
      .filter((h) => h.kind === "section")
      .map((h) => [h.at, h.text]),
  );
  for (const [at, line] of body.entries()) {
    const name = starts.get(at);
    if (name === undefined) {
      current[1].push(line);
      continue;
    }
    current = [name, []];
    groups.push(current);
  }
  return groups.map(([name, lines]) => [name, trimBlank(lines)]);
}

/** `lines` without the blank lines at either end. */
export function trimBlank(lines: readonly string[]): string[] {
  const text = lines.join("\n").replaceAll(EDGE_NEWLINES, "");
  return text === "" ? [] : text.split("\n");
}

/** Whether the Unreleased section of `parsed` has any entry text. */
export function unreleasedHasText({ sections }: Parsed): boolean {
  const unreleased = sections.find((section) => section.version === UNRELEASED);
  return unreleased?.body.some((line) => line.trim() !== "" && !HEADING.test(line)) ?? false;
}

/**
 * A positive number when `x` is the newer version, negative when `y` is, 0 when equal; a prerelease is below its
 * release.
 */
export function compareVersions(x: Parts, y: Parts): number {
  const differences = [x.major - y.major, x.minor - y.minor, x.patch - y.patch].map((gap) => Math.sign(gap));
  const core = differences.find((sign) => sign !== 0) ?? 0;
  if (core !== 0) return core;
  if (x.id === undefined || y.id === undefined) return Number(x.id === undefined) - Number(y.id === undefined);
  return x.id === y.id ? x.n - y.n : x.id.localeCompare(y.id);
}
