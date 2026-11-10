/** Every refusal and result line of `repo release`, so the words live in one place. */
export const PREFIX = "repo release: ";
export const USAGE =
  "usage: repo release [--stable | --pre <id>] | wait | gate | pack | publish | github <name>@<version> | consumer [<tarball>] | api [--against <tarball>]";
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
export const GATE_PREFIX = "repo release gate: ";
export const tagMissing = (tag: string): string => `the tag ${tag} does not exist here; fetch the tags`;
export const noManifestAt = (short: string): string => `package.json at ${short} needs a name and a version`;
export const nameDiffers = (tagName: string, short: string, name: string): string =>
  `the tag names ${tagName} but package.json at ${short} names ${name}`;
export const versionDiffers = (tagVersion: string, short: string, version: string): string =>
  `the tag says ${tagVersion} but package.json at ${short} says ${version}; a tag is never moved, so release the next version`;
export const noSection = (short: string, version: string): string =>
  `CHANGELOG.md at ${short} has no ## [${version}] section; publish is refused without one`;
export const notOnBranch = (short: string, branch: string): string =>
  `${short} is not on ${branch}; tag a commit on ${branch} after its CI passed`;
export const noDefaultBranch = (why: string): string =>
  `gh could not read the default branch (${why}); check gh auth status`;
export const gateOk = (tag: string, short: string, version: string): string =>
  `${tag} is ${short}, version ${version}, changelog ok`;
/** The refusal line for a ci wait that did not pass, by how it ended. */
export const gateCiLines = {
  failed: (short: string): string =>
    `CI failed on ${short}; a tag is never moved, so fix it in a new commit and release the next version`,
  superseded: (short: string): string => `a newer push cancelled CI on ${short}; rerun ci on it, then rerun this job`,
  error: (short: string, detail: string): string =>
    `no CI result for ${short} (${detail}); rerun this job once ci has run`,
};
export const PACK_PREFIX = "repo release pack: ";
export const PACK_ARGS = "takes no arguments; it packs the package in this checkout";
export const packFailed = (why: string): string => `bun pm pack failed: ${why}`;
export const PACKED_UNREADABLE = "the packed tarball has no readable package.json with a name and a version";
export const unpinned = (spec: string, dependency: string): string =>
  `the packed package.json names ${spec} for ${dependency}; pin it before releasing`;
export const PUBLISH_PREFIX = "repo release publish: ";
export const headNotTag = (tag: string): string => `HEAD is not ${tag}; check out the tag first`;
export const alreadyOnNpm = (tag: string): string => `${tag} is already on npm; nothing to publish`;
export const listedNotServed = (version: string): string =>
  `npm lists ${version} but its tarball is not served yet; waiting…`;
export const tarballNotServed = (tag: string, minutes: number): string =>
  `the tarball of ${tag} is not served after ${minutes} minutes; rerun this job`;
export type Bootstrap = { name: string; tag: string; repo: string; url: string; workflow: string };
export const bootstrap = ({ name, tag, repo, url, workflow }: Bootstrap): string =>
  `${name} is not on npm yet, and npm adds a trusted publisher only to a package that exists;\n` +
  `  run \`npm login\` and \`bun repo release publish ${tag}\` at that tag on your machine, then add the\n` +
  `  trusted publisher at ${url} (GitHub Actions, ${repo}, ${workflow})`;
export const tarballDiffers = (packed: string, tag: string): string =>
  `the tarball holds ${packed} but the tag is ${tag}; nothing was published`;
export const npmFailed = (code: number, version: string): string =>
  `npm publish exited ${code} and npm does not list ${version}; its output is above`;
export const publishedLine = (tag: string, npmTag: string): string =>
  `packed ${tag} · published under ${npmTag} · tarball served`;
export const GITHUB_PREFIX = "repo release github: ";
export const noNotes = (version: string): string =>
  `CHANGELOG.md has no ## [${version}] section to make the notes from`;
export const releaseCreated = (tag: string): string => `created release ${tag} from CHANGELOG.md`;
export const releaseExists = (tag: string): string => `release ${tag} already exists`;
export const createFailed = (why: string): string => `gh release create failed: ${why}`;
export const registryDown = (why: string, minutes: number): string =>
  `registry.npmjs.org did not answer for ${minutes} minutes (${why}); rerun the release job`;
export const packCount = (count: number, dir: string): string =>
  `bun pm pack left ${count} tarballs in ${dir}; expected exactly one`;
export const CONSUMER_PREFIX = "repo release consumer: ";
export const CONSUMER_ARGS = "takes at most one argument, the tarball to test";
export const noTarball = (tarball: string): string => `${tarball} does not exist`;
export const addFailed = (why: string): string => `bun add failed: ${why}`;
export const NO_EXPORTS = "package.json has no exports";
export const noRuntime = (key: string): string =>
  `${key} has a condition object with no default, import or require target`;
export const noMatch = (key: string): string => `${key} matches no file in the tarball`;
export const notInTarball = (key: string, target: string): string =>
  `${key} resolves to ${target}, which is not in the tarball`;
const PROBE_VERBS: Record<string, string> = { other: "resolve" };
export const failedProbe = (key: string, kind: string, why: string): string =>
  `${key} does not ${PROBE_VERBS[kind] ?? "import"}: ${why}`;
export const probeCrashed = (code: number, why: string): string => `the import probe exited ${code}: ${why}`;
export const typeError = (line: string): string => `types: ${line}`;
const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;
export const consumerOk = (spec: string, exports: number, subpaths: number): string =>
  `${spec} · ${count(exports, "export")}, ${count(subpaths, "subpath")} · imports ok · types ok`;
