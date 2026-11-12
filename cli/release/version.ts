import { HEADER, isBreaking } from "../conventional.ts";
import { FIRST_VERSION, MINOR_TYPES, PATCH_TYPES, SEMVER, STABLE_MAJOR, STABLE_VERSION } from "./release.constants.ts";

/** One commit since the last release: its subject line and the rest of its message. */
export type Commit = { subject: string; body: string };

/** What the person asked for: the next version by the commits, the 1.0.0 move, or a prerelease with an id. */
export type Mode = { kind: "auto" } | { kind: "stable" } | { kind: "pre"; id: string };

export type BumpInput = { current: string; commits: readonly Commit[]; mode: Mode; first: boolean };

/** The next version, or why there is none: nothing releasable, a 1.x `--stable`, a version that is not semver. */
export type Next = { ok: true; version: string } | { ok: false; reason: "nothing" | "stable" | "version" };

type Level = "major" | "minor" | "patch";

export type Parts = { major: number; minor: number; patch: number; id: string | undefined; n: number };

/** The numbers of a semver version and its prerelease id and number; null for any other text. */
export function parseSemver(version: string): Parts | null {
  const match = SEMVER.exec(version);

  if (match === null) return null;
  const [, major, minor, patch, id, n] = match;

  return { id, major: Number(major), minor: Number(minor), n: Number(n ?? 0), patch: Number(patch) };
}

/** The highest bump the commits ask for, as 1.0 and later read them; null when none is releasable. */
function levelOf(commits: readonly Commit[]): Level | null {
  let level: Level | null = null;

  for (const { subject, body } of commits) {
    const type = HEADER.exec(subject)?.groups?.["type"] ?? "";

    if (isBreaking(subject, body.split("\n"))) return "major";

    if (MINOR_TYPES.includes(type)) level = "minor";
    else if (PATCH_TYPES.includes(type) && level === null) level = "patch";
  }

  return level;
}

function bump({ major, minor, patch }: Parts, level: Level): string {
  // Below 1.0 a minor carries the breaking changes, so a breaking commit is a minor and the rest are patches.
  const isStable = major >= STABLE_MAJOR;

  if (level === "major" && isStable) return `${major + 1}.0.0`;

  if (level === "major" || (level === "minor" && isStable)) return `${major}.${minor + 1}.0`;

  return `${major}.${minor}.${patch + 1}`;
}

function base({ major, minor, patch }: Parts): string {
  return `${major}.${minor}.${patch}`;
}

function ok(version: string): Next {
  return { ok: true, version };
}

function fail(reason: "nothing" | "stable" | "version"): Next {
  return { ok: false, reason };
}

/** The release version before any prerelease suffix: `from`'s own base when `keep.base`, else the bump `level` asks. */
function targetOf(from: Parts, level: Level | null, keep: { base: boolean }): string | null {
  if (level === null) return null;

  return keep.base ? base(from) : bump(from, level);
}

/** The version `--stable` or a graduation sets whatever the commits say; null when neither applies. */
function fixedVersion(from: Parts, mode: Mode): Next | null {
  if (mode.kind === "stable") return from.major === 0 ? ok(STABLE_VERSION) : fail("stable");

  return mode.kind === "auto" && from.id !== undefined ? ok(base(from)) : null;
}

/** The version after `current`, per the commits since its release and the mode. */
export function nextVersion({ current, commits, mode, first }: BumpInput): Next {
  const from = parseSemver(current);

  if (from === null) return fail("version");
  const fixed = fixedVersion(from, mode);

  if (fixed !== null) return fixed;
  const keep = { base: mode.kind === "pre" && from.id !== undefined };
  const target = first ? FIRST_VERSION : targetOf(from, levelOf(commits), keep);

  if (target === null) return fail("nothing");

  return mode.kind === "pre" ? ok(`${target}-${mode.id}.${from.id === mode.id ? from.n + 1 : 0}`) : ok(target);
}
