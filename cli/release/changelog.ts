import {
  compareVersions,
  groupsOf,
  headings,
  linesOf,
  parseChangelog,
  trimBlank,
  unreleasedHasText,
  type Heading,
  type Parsed,
  type Section,
} from "./changelog-parse.ts";
import {
  CHANGELOG_FILE,
  DATE_FORMAT,
  DATED,
  SECTION_LIST,
  SECTIONS,
  UNRELEASED,
  VERSION_HEADING,
} from "./release.constants.ts";
import { parseSemver, type Parts } from "./version.ts";

/** The refusal for a changelog that does not exist. */
export function fileMissing(file: string): string {
  return `${file} is missing; add one in the Keep a Changelog format`;
}

/** The refusal for a changelog with no Unreleased section. */
export function noUnreleased(file: string): string {
  return `${file} has no ## [${UNRELEASED}] section; add it above the newest version`;
}

/** Whether the file's Unreleased section holds any entry. */
export function hasUnreleased(text: string): boolean {
  return unreleasedHasText(parseChangelog(text));
}

/** The versions listed so far, and the one listed last. */
type Listed = { file: string; seen: Set<string>; previous: { version: string; parts: Parts } | null };

/** The problem with one `##` heading, given the versions listed above it. */
function versionProblem(text: string, line: number, state: Listed): string | null {
  const where = `${state.file}:${line}`;
  const version = VERSION_HEADING.exec(text)?.[1] ?? "";

  if (version === UNRELEASED) return null;
  const parts = parseSemver(version);

  if (parts === null) return `${where}: "## ${text}" is not a version; write ## [x.y.z] - ${DATE_FORMAT}`;

  if (!DATED.test(text)) return `${where}: "## ${text}" needs a date; write ## [${version}] - ${DATE_FORMAT}`;
  const { seen, previous } = state;
  const twice = seen.has(version);
  const newer = previous !== null && compareVersions(parts, previous.parts) > 0 ? previous.version : null;
  seen.add(version);
  state.previous = { parts, version };

  if (twice) return `${where}: ${version} is listed twice; merge the sections`;

  return newer === null ? null : `${where}: ${version} is below ${newer}; list versions newest first`;
}

/**
 * One line per way the changelog text strays from Keep a Changelog; the single line "is missing" for no file. The
 * lines name the file as `file`.
 */
export function changelogFormatProblems(text: string | null, file: string = CHANGELOG_FILE): string[] {
  if (text === null) return [fileMissing(file)];
  const state: Listed = { file, previous: null, seen: new Set() };
  const problems: string[] = [];

  for (const { at, kind, text: heading } of headings(linesOf(text))) {
    if (kind === "section" && !SECTIONS.includes(heading))
      problems.push(`${file}:${at + 1}: "### ${heading}" is not a section; use ${SECTION_LIST}`);

    const problem = kind === "version" ? versionProblem(heading, at + 1, state) : null;

    if (problem !== null) problems.push(problem);
  }

  if (!parseChangelog(text).sections.some(({ version }) => version === UNRELEASED)) problems.push(noUnreleased(file));

  return problems;
}

/** The `###` groups of `bodies` merged by name: loose text, then the Keep a Changelog sections, then other names. */
function mergeBodies(bodies: readonly (readonly string[])[]): string {
  const merged = new Map<string, string[]>();

  for (const body of bodies) {
    for (const [name, lines] of groupsOf(body))
      if (lines.length > 0) merged.set(name, [...(merged.get(name) ?? []), ...lines]);
  }

  const known = ["", ...SECTIONS];

  function rank(name: string): number {
    return known.includes(name) ? known.indexOf(name) : known.length;
  }

  return [...merged]
    .toSorted(([a], [b]) => rank(a) - rank(b))
    .map(([name, lines]) => (name === "" ? "" : `### ${name}\n\n`) + lines.join("\n"))
    .join("\n\n");
}

/** Whether `section` is a prerelease of the stable `version`. */
function prereleaseOf(section: Section, version: string): boolean {
  return !version.includes("-") && section.version !== null && section.version.startsWith(`${version}-`);
}

/** Text of one section as a block: the heading, a blank line, the body. */
function block(heading: string, body: readonly string[]): string {
  return [heading, ...(trimBlank(body).length > 0 ? ["", ...trimBlank(body)] : [])].join("\n");
}

/**
 * The changelog with its Unreleased entries moved under `## [version] - date` and an empty Unreleased above it. A
 * section for the version already there takes the entries by `###` heading, and for a stable version the sections of
 * its prereleases fold in and go.
 */
export function stampChangelog(text: string, version: string, date: string): string {
  const { preamble, sections }: Parsed = parseChangelog(text);
  const unreleased = sections.find((section) => section.version === UNRELEASED);
  const existing = sections.find((section) => section.version === version);
  const folded = sections.filter((section) => prereleaseOf(section, version));
  const taken = new Set<Section | undefined>([unreleased, existing, ...folded]);
  const bodies = [unreleased, existing, ...folded].filter((section) => section !== undefined).map((s) => s.body);
  const stamped = block(existing?.heading ?? `## [${version}] - ${date}`, mergeBodies(bodies).split("\n"));
  const rest = sections.filter((section) => !taken.has(section)).map(({ heading, body }) => block(heading, body));
  const head = trimBlank(preamble).join("\n");

  return `${[head, `## [${UNRELEASED}]`, stamped, ...rest].filter((part) => part !== "").join("\n\n")}\n`;
}

const LEADING_DASH = /^- /;
const CRLF = "\r\n";

/** The index of the last line of `lines` from `from` up to `to` that holds text. */
function lastText(lines: readonly string[], from: number, to: number): number {
  return from + lines.slice(from, to).findLastIndex((line) => line.trim() !== "");
}

/** The changelog with the entry added, and the 1-based line of its bullet. */
export type Inserted = { text: string; line: number };

/** The Unreleased section of `lines`: where it starts and ends, and its `###` headings. */
type Span = { start: number; end: number; groups: Heading[] };

/** The Unreleased section of `lines`, or undefined when there is none. */
function unreleasedSpan(lines: readonly string[]): Span | undefined {
  const found = headings(lines);
  const head = found.find(({ kind, text }) => kind === "version" && VERSION_HEADING.exec(text)?.[1] === UNRELEASED);
  const start = head?.at ?? 0;
  const end = found.find(({ at, kind }) => kind === "version" && at > start)?.at ?? lines.length;

  return head === undefined
    ? undefined
    : { end, groups: found.filter(({ at, kind }) => kind === "section" && at > start && at < end), start };
}

/** The group and the bullet line to add to it. */
type Wanted = { section: string; bullet: string };

/** Where the bullet goes: the index of the line it goes before, and the lines to put there. */
function placement(lines: readonly string[], span: Span, { section, bullet }: Wanted) {
  const heading = `### ${section}`;
  const own = span.groups.find(({ text }) => text === section);
  const later = span.groups.find(({ text }) => SECTIONS.indexOf(text) > SECTIONS.indexOf(section));

  if (own !== undefined) {
    const last = lastText(lines, own.at, span.groups.find(({ at }) => at > own.at)?.at ?? span.end);

    return { added: last === own.at ? ["", bullet] : [bullet], at: last + 1 };
  }

  if (later !== undefined) return { added: [heading, "", bullet, ""], at: later.at };

  return { added: ["", heading, "", bullet], at: lastText(lines, span.start, span.end) + 1 };
}

/**
 * Adds `- entry` under `### section` of the Unreleased section: after the last line of that group, or in a new group
 * that keeps the Keep a Changelog order. Only lines of Unreleased change; CRLF endings stay. Null when there is no
 * Unreleased section.
 */
export function insertEntry(text: string, section: string, entry: string): Inserted | null {
  const plain = text.replaceAll(CRLF, "\n");
  const lines = linesOf(plain);
  const span = unreleasedSpan(lines);

  if (span === undefined) return null;
  const bullet = `- ${entry.replace(LEADING_DASH, "")}`;
  const { added, at } = placement(lines, span, { bullet, section });
  const joined = `${lines.toSpliced(at, 0, ...added).join("\n")}${plain.endsWith("\n") ? "\n" : ""}`;

  return { line: at + added.indexOf(bullet) + 1, text: text.includes(CRLF) ? joined.replaceAll("\n", CRLF) : joined };
}
