/** Every refusal and result line of `repo release`, so the words live in one place. */
export const PREFIX = "repo release: ";
export const USAGE: string =
  "usage: repo release [--stable | --pre <id>] | wait | gate | pack | publish | github <name>@<version> " +
  "| consumer [<tarball>] | api [--against <tarball>]";
export const DIRTY = "the working tree has changes; commit or stash them first";
export const GH_MISSING = "gh is not installed or not logged in; run `gh auth login`";
export const EMPTY_UNRELEASED = "CHANGELOG.md has no entries under ## [Unreleased]; add them first";
export const PACK_OFF = 'the release pack is off; add "release" to packs in workerstack.config.ts';
export const NO_MANIFEST = "package.json needs a name and a version";
export const NOT_CHECKOUT = "run it inside a git checkout";
export function notMain(main: string, branch: string): string {
  return `release from ${main}; this checkout is on ${branch}`;
}
export function differs(main: string, behind: number, ahead: number): string {
  return `${main} and origin/${main} differ (${behind} behind, ${ahead} ahead); pull or push first`;
}
export function nothing(since: string | null): string {
  return `nothing to release since ${since ?? "the first commit"}: no feat, fix, perf, revert or breaking commit`;
}
export function isPrivate(name: string): string {
  return `${name} is private; set "private": false to publish it`;
}
export function stableOnly(name: string, version: string): string {
  return `--stable moves a 0.x version to 1.0.0; ${name} is ${version}`;
}
export function notSemver(name: string, version: string): string {
  return `${name} is at ${version}, which is not semver`;
}
export function tagExists(tag: string): string {
  return `the tag ${tag} already exists; a tag is never moved, so release the next version`;
}
export function gitFailed(command: string, why: string): string {
  return `git ${command} failed: ${why}`;
}
export function ciFailed(short: string): string {
  return `CI failed on ${short} (jobs above); fix it in a new commit, push, and run bun repo release again`;
}
export function ciSuperseded(short: string): string {
  return `a newer push cancelled CI on ${short}; pull and run bun repo release again`;
}
export function ciNoResult(short: string, detail: string): string {
  return `no CI result for ${short} (${detail}); it is pushed and untagged; run bun repo release again`;
}
export function ciNothing(short: string, why: string): string {
  return `${why}; ${short} is pushed and untagged; open a pull request or release from the default branch`;
}
export type Summary = { name: string; move: string; steps: readonly string[]; tag: string };
export function summary({ name, move, steps, tag }: Summary): string {
  return [`${name} ${move}`, ...steps, "CI passed", `tagged ${tag}`].join(" · ");
}
export const WAIT_PREFIX = "repo release wait: ";
export const WAIT_USAGE = "name the tag as <name>@<version>, e.g. @workerstack/repo@1.0.0";
export function published(version: string, tag: string | undefined): string {
  return tag === undefined ? `published ${version}` : `published ${version} under ${tag}`;
}
export function notOnNpm(spec: string, minutes: number): string {
  return `${spec} is not on npm after ${minutes} minutes; see gh run list --workflow release`;
}
export const HOOKS_REFUSED =
  "the hooks refused the release commit (output above); nothing was changed, so fix it and run bun repo release again";
export const GATE_PREFIX = "repo release gate: ";
export function tagMissing(tag: string): string {
  return `the tag ${tag} does not exist here; fetch the tags`;
}
export function noManifestAt(short: string): string {
  return `package.json at ${short} needs a name and a version`;
}
export function nameDiffers(tagName: string, short: string, name: string): string {
  return `the tag names ${tagName} but package.json at ${short} names ${name}`;
}
export function versionDiffers(tagVersion: string, short: string, version: string): string {
  return (
    `the tag says ${tagVersion} but package.json at ${short} says ${version}; ` +
    "a tag is never moved, so release the next version"
  );
}
export function noSection(short: string, version: string): string {
  return `CHANGELOG.md at ${short} has no ## [${version}] section; publish is refused without one`;
}
export function notOnBranch(short: string, branch: string): string {
  return `${short} is not on ${branch}; tag a commit on ${branch} after its CI passed`;
}
export function noDefaultBranch(why: string): string {
  return `gh could not read the default branch (${why}); check gh auth status`;
}
export function gateOk(tag: string, short: string, version: string): string {
  return `${tag} is ${short}, version ${version}, changelog ok`;
}
/** The refusal line for a ci wait that did not pass, by how it ended. */
export const gateCiLines = {
  error: (short: string, detail: string): string =>
    `no CI result for ${short} (${detail}); rerun this job once ci has run`,
  failed: (short: string): string =>
    `CI failed on ${short}; a tag is never moved, so fix it in a new commit and release the next version`,
  nothing: (short: string, why: string): string =>
    `no CI will run for ${short} (${why}); release from a branch ci runs on`,
  superseded: (short: string): string => `a newer push cancelled CI on ${short}; rerun ci on it, then rerun this job`,
};
export const PACK_PREFIX = "repo release pack: ";
export const PACK_ARGS = "takes no arguments; it packs the package in this checkout";
export function packFailed(why: string): string {
  return `bun pm pack failed: ${why}`;
}
export const PACKED_UNREADABLE = "the packed tarball has no readable package.json with a name and a version";
export function unpinned(spec: string, dependency: string): string {
  return `the packed package.json names ${spec} for ${dependency}; pin it before releasing`;
}
export const PUBLISH_PREFIX = "repo release publish: ";
export function headNotTag(tag: string): string {
  return `HEAD is not ${tag}; check out the tag first`;
}
export function alreadyOnNpm(tag: string): string {
  return `${tag} is already on npm; nothing to publish`;
}
export function listedNotServed(version: string): string {
  return `npm lists ${version} but its tarball is not served yet; waiting…`;
}
export function tarballNotServed(tag: string, minutes: number): string {
  return `the tarball of ${tag} is not served after ${minutes} minutes; rerun this job`;
}
export type Bootstrap = { name: string; tag: string; repo: string; url: string; workflow: string };
export function bootstrap({ name, tag, repo, url, workflow }: Bootstrap): string {
  return (
    `${name} is not on npm yet, and npm adds a trusted publisher only to a package that exists;\n` +
    `  run \`npm login\` and \`bun repo release publish ${tag}\` at that tag on your machine, then add the\n` +
    `  trusted publisher at ${url} (GitHub Actions, ${repo}, ${workflow})`
  );
}
export function tarballDiffers(packed: string, tag: string): string {
  return `the tarball holds ${packed} but the tag is ${tag}; nothing was published`;
}
export function npmFailed(code: number, version: string): string {
  return `npm publish exited ${code} and npm does not list ${version}; its output is above`;
}
export function publishedLine(tag: string, npmTag: string): string {
  return `packed ${tag} · published under ${npmTag} · tarball served`;
}
export const GITHUB_PREFIX = "repo release github: ";
export function noNotes(version: string): string {
  return `CHANGELOG.md has no ## [${version}] section to make the notes from`;
}
export function releaseCreated(tag: string): string {
  return `created release ${tag} from CHANGELOG.md`;
}
export function releaseExists(tag: string): string {
  return `release ${tag} already exists`;
}
export function createFailed(why: string): string {
  return `gh release create failed: ${why}`;
}
export function registryDown(why: string, minutes: number): string {
  return `registry.npmjs.org did not answer for ${minutes} minutes (${why}); rerun the release job`;
}
export function packCount(count: number, dir: string): string {
  return `bun pm pack left ${count} tarballs in ${dir}; expected exactly one`;
}
export const CONSUMER_PREFIX = "repo release consumer: ";
export const CONSUMER_ARGS = "takes at most one argument, the tarball to test";
export function noTarball(tarball: string): string {
  return `${tarball} does not exist`;
}
export function addFailed(why: string): string {
  return `bun add failed: ${why}`;
}
export const NO_EXPORTS = "package.json has no exports";
export function noRuntime(key: string): string {
  return `${key} has a condition object with no default, import or require target`;
}
export function noMatch(key: string): string {
  return `${key} matches no file in the tarball`;
}
export function notInTarball(key: string, target: string): string {
  return `${key} resolves to ${target}, which is not in the tarball`;
}
const PROBE_VERBS: Record<string, string> = { other: "resolve" };
export function failedProbe(key: string, kind: string, why: string): string {
  return `${key} does not ${PROBE_VERBS[kind] ?? "import"}: ${why}`;
}
export function probeCrashed(code: number, why: string): string {
  return `the import probe exited ${code}: ${why}`;
}
export function typeError(line: string): string {
  return `types: ${line}`;
}
function counted(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
export function consumerOk(spec: string, exports: number, subpaths: number): string {
  return `${spec} · ${counted(exports, "export")}, ${counted(subpaths, "subpath")} · imports ok · types ok`;
}
