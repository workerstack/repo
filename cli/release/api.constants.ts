import type { Change } from "./api-diff.ts";

export const API_PREFIX: string = "repo release api: ";
export const API_ARGS: string = "usage: repo release api [--against <tarball>]";
export const AGAINST_FLAG: string = "--against";

/** The flag and its tarball. */
export const AGAINST_ARGS: number = 2;
export const THIS_CHECKOUT: string = "this checkout";
export const ARROW: string = " → ";
const BREAKING_FIX: string = "mark the commit that removed it with `!` or a `BREAKING CHANGE:` footer";
export const FEAT_TYPE: string = "feat";
export const PART_SEPARATOR: string = " · ";
const AND: string = " and ";

/** Where the old version comes from, how the lines call it, and what it is installed from. */
export type OldSource = {
  /** The short name of the old version in refusals: its version, or the tarball as given. */
  label: string;
  /** The name of it in the ok line. */
  title: string;
  /** What the install failure says it was installing. */
  what: string;
  /** The release tag of the manifest's version, as the refusals name it. */
  tag: string;
  /** The tag as git has it, or null when the repo has none. */
  since: string | null;
  /** Whether the ok line counts the feat commits since the tag. */
  feats: boolean;
};

export function noTagYet(tag: string): string {
  return `no tag ${tag} for the version in package.json; nothing to compare`;
}

export function noTarballAt(tarball: string): string {
  return `no tarball at ${tarball}`;
}

export function installFailed(what: string, why: string): string {
  return `could not install ${what}: ${why}`;
}

function where(change: Change): string {
  return change.name === null ? `"${change.key}"` : `\`${change.name}\` in "${change.key}"`;
}

/** The refusal for a removed or narrowed change that no breaking commit covers. */
export function breakingLine(change: Change, label: string, tag: string): string {
  const none = `and no commit since ${tag} is breaking`;

  if (change.kind === "removed") return `${where(change)} was removed since ${label}, ${none}: ${BREAKING_FIX}`;
  const lost = `narrowed since ${label} (a ${label} value no longer fits it)`;

  return `${where(change)} ${lost}, ${none}: mark it breaking, or keep the old shape`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The refusal for added or widened changes that no feat commit covers. */
export function featLine(changes: readonly Change[], label: string, tag: string): string {
  const subpaths = changes.filter((change) => change.name === null).map(where);
  const names = changes.filter((change) => change.name !== null);
  const named = names.length === 1 ? names.map(where) : [plural(names.length, "name")];
  const items = [...subpaths, ...(names.length === 0 ? [] : named)];
  const verb = changes.length === 1 ? "is" : "are";
  const tail = `and no commit since ${tag} is a feat: commit them as \`feat\``;

  return `${items.join(AND)} ${verb} new or widened since ${label}, ${tail}`;
}

/** The counts of the ok line. */
export type Counts = { subpaths: number; added: number; widened: number; breaking: number };

export function countsPart({ subpaths, added, widened, breaking }: Counts): string {
  return `${plural(subpaths, "code subpath")}${PART_SEPARATOR}${added} added, ${widened} widened, ${breaking} breaking`;
}

export function featsPart(count: number): string {
  return `feat commits: ${count}`;
}

/** The file whose presence makes this a Rust repo. */
export const CARGO_MANIFEST: string = "Cargo.toml";
export const NOTHING_TO_COMPARE: string = "no publishable crate and no public package; nothing to compare";
export const AGAINST_NO_PACKAGE: string = "--against compares a package tarball; this repo has no public package";
