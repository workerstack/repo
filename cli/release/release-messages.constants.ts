/** Every refusal and result line of `repo release`, so the words live in one place. */
export const PREFIX = "repo release: ";
export const USAGE = "usage: bun repo release [--stable | --pre <id>]  |  bun repo release wait <name>@<version>";
export const DIRTY = "the working tree has changes; commit or stash them first";
export const GH_MISSING = "gh is not installed or not logged in; run `gh auth login`";
export const EMPTY_UNRELEASED = "CHANGELOG.md has no entries under ## [Unreleased]; add them first";
export const PACK_OFF = 'the release pack is off; add "release" to packs in workerstack.config.ts';
export const NO_MANIFEST = "package.json needs a name and a version";
export const NOT_CHECKOUT = "run it inside a git checkout";
export const notMain = (main: string, branch: string): string => `release from ${main}; this checkout is on ${branch}`;
export const differs = (main: string, behind: number, ahead: number): string =>
  `${main} and origin/${main} differ (${behind} behind, ${ahead} ahead); pull or push first`;
export const nothing = (since: string | null): string =>
  `nothing to release since ${since ?? "the first commit"}: no feat, fix, perf, revert or breaking commit`;
export const isPrivate = (name: string): string => `${name} is private; set "private": false to publish it`;
export const stableOnly = (name: string, version: string): string =>
  `--stable moves a 0.x version to 1.0.0; ${name} is ${version}`;
export const notSemver = (name: string, version: string): string => `${name} is at ${version}, which is not semver`;
export const tagExists = (tag: string): string =>
  `the tag ${tag} already exists; a tag is never moved, so release the next version`;
export const gitFailed = (command: string, why: string): string => `git ${command} failed: ${why}`;
export const ciFailed = (short: string): string =>
  `CI failed on ${short} (jobs above); fix it in a new commit, push, and run bun repo release again`;
export const ciSuperseded = (short: string): string =>
  `a newer push cancelled CI on ${short}; pull and run bun repo release again`;
export const ciNoResult = (short: string, detail: string): string =>
  `no CI result for ${short} (${detail}); it is pushed and untagged; run bun repo release again`;
export type Summary = { name: string; move: string; steps: readonly string[]; tag: string };
export const summary = ({ name, move, steps, tag }: Summary): string =>
  [`${name} ${move}`, ...steps, "CI passed", `tagged ${tag}`].join(" · ");
export const WAIT_PREFIX = "repo release wait: ";
export const WAIT_USAGE = "name the tag as <name>@<version>, e.g. @workerstack/repo@1.0.0";
export const published = (version: string, tag: string | undefined): string =>
  tag === undefined ? `published ${version}` : `published ${version} under ${tag}`;
export const notOnNpm = (spec: string, minutes: number): string =>
  `${spec} is not on npm after ${minutes} minutes; see gh run list --workflow release`;
export const HOOKS_REFUSED =
  "the hooks refused the release commit (output above); nothing was changed, so fix it and run bun repo release again";
