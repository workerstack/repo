/** Where the semver of a version string splits: major, minor, patch and an optional `-id.N` prerelease. */
export const SEMVER: RegExp = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z]+)\.(\d+))?$/;
export const FIRST_VERSION: string = "0.1.0";
export const STABLE_VERSION: string = "1.0.0";
export const STABLE_MAJOR: number = 1;
/** Commit types that make a release, and the bump each makes from 1.0. */
export const PATCH_TYPES: readonly string[] = ["fix", "perf", "revert"];
export const MINOR_TYPES: readonly string[] = ["feat"];

export const CHANGELOG_FILE: string = "CHANGELOG.md";
/** The sections of Keep a Changelog, in the order they are written. */
export const SECTIONS: readonly string[] = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];
export const UNRELEASED: string = "Unreleased";
export const DATE_FORMAT: string = "YYYY-MM-DD";
export const FENCE: string = "```";
export const HEADING: RegExp = /^(##|###) (.*)$/;
export const VERSION_HASHES: string = "##";
export const SECTION_LIST: string = "Added, Changed, Deprecated, Removed, Fixed or Security";
export const ZERO_VERSION: string = "0.0.0";
export const WAIT_COMMAND: string = "wait";
export const HELP_COMMAND: string = "help";
export const GATE_COMMAND: string = "gate";
export const PACK_COMMAND: string = "pack";
export const PUBLISH_COMMAND: string = "publish";
export const GITHUB_COMMAND: string = "github";
export const GITHUB_ACTIONS_ON: string = "true";
export const VERSION_HEADING: RegExp = /^\[([^\]]+)\]/;
export const DATED: RegExp = /^\[[^\]]+\] - \d{4}-\d{2}-\d{2}$/;

export const RELEASE_PACK: string = "release";
export const ARROW: string = "→";
export const FLAG_STABLE: string = "--stable";
export const FLAG_PRE: string = "--pre";
export const PRE_ID: RegExp = /^[0-9A-Za-z]+$/;
export const MAIN_FALLBACK: string = "main";
export const ORIGIN_HEAD_PREFIX: string = "refs/remotes/origin/";
export const RELEASE_SUBJECT = (tag: string): string => `chore: release ${tag}`;
export const TAG_OF = (name: string, version: string): string => `${name}@${version}`;
export const BARE_TAG_OF = (version: string): string => `v${version}`;
export const SHA_SHOWN: number = 7;
export const COMMIT_SEPARATOR: string = "\x1f";
export const COMMIT_END: string = "\x1e";
export const MANIFEST_FILE: string = "package.json";
export const VERSION_LINE: RegExp = /("version"\s*:\s*)"[^"]*"/;
export const GIT_TOPLEVEL: readonly string[] = ["rev-parse", "--show-toplevel"];
export const GIT_ORIGIN_HEAD: readonly string[] = ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"];
export const GIT_BRANCH: readonly string[] = ["rev-parse", "--abbrev-ref", "HEAD"];
export const GIT_HEAD: readonly string[] = ["rev-parse", "HEAD"];
export const GIT_STATUS: readonly string[] = ["status", "--porcelain"];
export const GIT_FETCH: readonly string[] = ["fetch", "--quiet", "--tags", "origin"];
export const GIT_RESET: readonly string[] = ["reset", "--quiet", "--hard", "HEAD"];
export const GIT_AHEAD_BEHIND = (branch: string): string[] => [
  "rev-list",
  "--left-right",
  "--count",
  `HEAD...origin/${branch}`,
];
export const GIT_TAG_REF = (tag: string): string[] => ["rev-parse", "--quiet", "--verify", `refs/tags/${tag}^{commit}`];
export const GIT_RELEASE_LOG = (subject: string): string[] => [
  "log",
  "--fixed-strings",
  `--grep=${subject}`,
  "--format=%H%x09%s",
];
export const GIT_COMMITS = (since: string | null): string[] => [
  "log",
  `--format=%s%x1f%b%x1e`,
  ...(since === null ? [] : [`${since}..HEAD`]),
];
export const GIT_ADD: readonly string[] = ["add", "--", MANIFEST_FILE, CHANGELOG_FILE];
export const GIT_COMMIT = (subject: string): string[] => ["commit", "--quiet", "-m", subject];
export const GIT_PUSH = (branch: string): string[] => ["push", "--quiet", "origin", branch];
export const GIT_TAG = (tag: string): string[] => ["tag", "-a", tag, "-m", tag];
export const GIT_PUSH_TAG = (tag: string): string[] => ["push", "--quiet", "origin", `refs/tags/${tag}`];
export const GIT_TAG_DELETE = (tag: string): string[] => ["tag", "-d", tag];
export const PREFIX_SEPARATOR: string = "\nrepo release: ";
export const REGISTRY: string = "https://registry.npmjs.org/";
export const SCOPE_SLASH: string = "/";
export const ENCODED_SLASH: string = "%2f";
export const WAIT_POLL_MS: number = 10_000;
export const WAIT_GIVE_UP_MS: number = 900_000;
export const WAIT_GIVE_UP_MINUTES: number = 15;
export const ISO_DATE_LENGTH: number = 10;
export const GIT_SHOW = (sha: string, file: string): string[] => ["show", `${sha}:${file}`];
export const GIT_ON_BRANCH = (sha: string, branch: string): string[] => [
  "merge-base",
  "--is-ancestor",
  sha,
  `origin/${branch}`,
];
export const GH_DEFAULT_BRANCH: readonly string[] = ["repo", "view", "--json", "defaultBranchRef"];
export const GIT_ORIGIN_URL: readonly string[] = ["remote", "get-url", "origin"];
export const GITHUB_REPO: RegExp = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/;
export const REPO_PLACEHOLDER: string = "<owner>/<repo>";
export const RELEASE_WORKFLOW: string = "release.yml";
export const ACCESS_URL = (name: string): string => `https://www.npmjs.com/package/${name}/access`;
export const TARBALL_URL = (name: string, version: string): string =>
  `${REGISTRY}${name}/-/${name.slice(name.lastIndexOf("/") + 1)}-${version}.tgz`;
export const NPM_PUBLISH = (tarball: string, prerelease: boolean): string[] => [
  "publish",
  tarball,
  "--access",
  "public",
  "--ignore-scripts",
  ...(prerelease ? ["--tag", "next"] : []),
];
export const NPM_TAG = (prerelease: boolean): string => (prerelease ? "next" : "latest");
export const GH_RELEASE_VIEW = (tag: string): string[] => ["release", "view", tag];
export const GH_RELEASE_CREATE = (tag: string, notes: string, prerelease: boolean): string[] => [
  "release",
  "create",
  tag,
  "--verify-tag",
  "--title",
  tag,
  "--notes",
  notes,
  ...(prerelease ? ["--prerelease"] : []),
];
export const PACK_DIR_PREFIX: string = "repo-pack-";
export const BUN_PACK = (dir: string): string[] => ["pm", "pack", "--destination", dir, "--quiet"];
/** `tarball` is a name in the directory tar runs in. */
export const TAR_MANIFEST = (tarball: string): string[] => ["-xOzf", tarball, "package/package.json"];
/** Manifest versions that only mean something inside a workspace or against a catalog. */
export const UNPINNED: RegExp = /^(catalog|workspace):/;
export const NOT_FOUND: number = 404;
export const NOT_A_DOCUMENT: string = "an answer that is not a package document";
export const TARBALL_EXTENSION: string = ".tgz";
