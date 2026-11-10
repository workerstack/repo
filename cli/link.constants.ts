/** The state file, under the install root's ignored `.repo/tmp`. */
export const STATE_DIR = ".repo/tmp";
export const STATE_FILE = "links.json";
export const STATE_VERSION = 1;
export const JSON_INDENT = 2;
/** Written into every swapped package dir: a linked copy can carry npm's version. */
export const MARKER_FILE = ".repo-link";
export const MODULES = "node_modules";
export const BIN_DIR = ".bin";
/** Inside the install dir, so a swap's rename never crosses filesystems. */
export const STAGING_DIR = "node_modules/.repo-link";
export const SWAP_PREFIX = "swap-";
export const OLD_DIR = "old";
export const UNPACKED_DIR = "x";
export const PACKED_DIR = "package";

export const CMD_LINK = "link";
export const CMD_UNLINK = "unlink";
export const CMD_STATUS = "status";
/** The help lines of `repo link` and `repo unlink`. */
export const LINK_SUMMARY =
  "Swap a dependency for a packed sibling checkout (status: list links; --pre-push: the push check)";
export const UNLINK_SUMMARY = "Put a linked dependency back on npm (--all: every link)";
export const FLAG_ALL = "--all";
export const FLAG_PRE_PUSH = "--pre-push";
export const OPTION_PREFIX = "-";
export const EXIT_FAIL = 1;
export const EXIT_USAGE = 2;
export const SCOPE_PREFIX = "@";
export const TIME_DIGITS = 2;

export const USAGE = "usage: repo link <name> | repo link status | repo link --pre-push; repo unlink <name> | --all";
export const NO_LINKS = "No links; every package comes from npm.";
export const NOT_INSTALLED = "(not installed)";
export const NPM_NONE = "none";
export const NPM_UNKNOWN = "unknown";
export const NEVER = "never";

export const LINK_OBJECT_ERROR = 'must be an object like { "@workerstack/flare": "../flare" }';
export const LINK_PATH_ERROR = "must be a path like ../flare, relative to the repo root";

/** The line for a link that worked: the package and version, where it came from, and the npm version it replaced. */
export const linkedLine = (name: string, version: string, from: string): string =>
  `linked ${name} ${version} from ${from}`;
/** The suffix of that line naming the npm version the swap replaced. */
export const npmHad = (npm: string): string => ` (npm had ${npm})`;
/** The line that says how to undo a link. */
export const undoLine = (name: string): string => `${name} is linked; \`bun repo unlink ${name}\` puts npm back`;
/** The line for a link taken out. */
export const unlinkedLine = (name: string, npm: string): string => `unlinked ${name}: back on npm ${npm}`;
/** The error for a name no sibling publishes. */
export const noSibling = (main: string, name: string): string =>
  `no sibling of ${main} publishes "${name}"; clone it beside this checkout, or map it in workerstack.config.ts \`link\``;
/** The error for a sibling dir that has no package this repo uses. */
export const publishesNothing = (dir: string): string => `${dir} publishes nothing this repo depends on`;
/** The error for a mapped checkout that lacks the package. */
export const notPublished = (dir: string, name: string): string =>
  `${dir} does not publish ${name}; fix \`link\` in workerstack.config.ts`;
/** The error for a sibling that cannot build. */
export const siblingNoInstall = (dir: string): string =>
  `${dir} has no node_modules, so its prepack cannot build; run \`bun install\` there`;
/** The error for a checkout with nothing to link into. */
export const noInstall = (dir: string): string => `${dir} has no node_modules; run \`bun install\` there`;
/** The error for a pack that failed, with the pack's own output indented under it. */
export const packFailed = (name: string, output: string): string =>
  `${name} failed to pack; node_modules keeps the last good copy:\n  ${output.replaceAll("\n", "\n  ")}`;
/** The error for an install that failed after the links were dropped. */
export const installFailed = (code: number): string =>
  `bun install failed (exit ${code}); node_modules may still hold the linked copy:`;
/** The error for a state file that does not parse. */
export const badState = (file: string, why: string): string =>
  `${file} is not a valid link state (${why}); delete it to reset`;
/** The warning for a dependency of a linked package that this checkout lacks or holds outside its range. */
export const needsDependency = (name: string, dep: string, range: string): string =>
  `warning: ${name} needs ${dep} ${range}, this checkout`;
/** What follows that warning: the version the checkout holds, or that it holds none. */
export const checkoutHolds = (have: string | null): string => (have === null ? "does not install it" : `has ${have}`);
/** The line for a link put back after an install. */
export const relinkedLine = (name: string, version: string, from: string): string =>
  `repo link: relinked ${name} ${version} from ${from}`;
/** The warning for a link whose source checkout is gone. */
export const goneLine = (name: string, source: string): string =>
  `repo link: warning: ${source} is gone; ${name} stays on npm; \`bun repo unlink ${name}\` forgets it`;
/** The prefix of a reapply warning. */
export const WARNING_PREFIX = "repo link: warning: ";
/** The refusal for a public package that depends on a linked one. */
export const refusedPush = (pkg: string, linked: string): string =>
  `${pkg} is public and depends on linked ${linked}; \`bun repo unlink ${linked}\` before pushing`;
