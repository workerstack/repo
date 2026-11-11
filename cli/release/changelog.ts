import {
  compareVersions,
  groupsOf,
  headings,
  linesOf,
  parseChangelog,
  trimBlank,
  unreleasedHasText,
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

/** Whether the file's Unreleased section holds any entry. */
export function hasUnreleased(text: string): boolean {
  return unreleasedHasText(parseChangelog(text));
}

/** The versions listed so far, and the one listed last. */
type Listed = { seen: Set<string>; previous: { version: string; parts: Parts } | null };

/** The problem with one `##` heading, given the versions listed above it. */
function versionProblem(text: string, line: number, state: Listed): string | null {
  const where = `${CHANGELOG_FILE}:${line}`;
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

/** One line per way the changelog text strays from Keep a Changelog; the single line "is missing" for no file. */
export function changelogFormatProblems(text: string | null): string[] {
  if (text === null) return [`${CHANGELOG_FILE} is missing; add one in the Keep a Changelog format`];
  const state: Listed = { previous: null, seen: new Set() };
  const problems: string[] = [];
  for (const { at, kind, text: heading } of headings(linesOf(text))) {
    if (kind === "section" && !SECTIONS.includes(heading))
      problems.push(`${CHANGELOG_FILE}:${at + 1}: "### ${heading}" is not a section; use ${SECTION_LIST}`);

    const problem = kind === "version" ? versionProblem(heading, at + 1, state) : null;
    if (problem !== null) problems.push(problem);
  }
  if (!parseChangelog(text).sections.some(({ version }) => version === UNRELEASED))
    problems.push(`${CHANGELOG_FILE} has no ## [${UNRELEASED}] section; add it above the newest version`);

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
