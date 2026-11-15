/** The state file, under the install root's ignored `.repo/tmp`. */
export const STATE_DIR = ".repo/tmp";
export const STATE_FILE = "links.json";
export const STATE_VERSION = 1;
export const JSON_INDENT = 2;

/** Written into every swapped package dir: a linked copy can carry npm's version. */
export const MARKER_FILE = ".repo-link";
export const MODULES = "node_modules";
export const BIN_DIR = ".bin";

/** The entry at a checkout's top (a dir, or a worktree's file): the search for a sibling's dependencies stops there. */
export const CHECKOUT_TOP = ".git";

/** The dir link type Windows makes without admin rights; POSIX ignores it. */
export const DIR_LINK = "junction";

/** Inside the install dir, so a swap's rename never crosses filesystems. */
export const STAGING_DIR = "node_modules/.repo-link";
export const SWAP_PREFIX = "swap-";
export const OLD_DIR = "old";
export const UNPACKED_DIR = "x";
export const PACKED_DIR = "package";

export const CMD_LINK = "link";
export const CMD_UNLINK = "unlink";
export const CMD_STATUS = "status";
export const CMD_PUSH = "push";
export const FLAG_HOOK = "--hook";

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

/** How to call `repo unlink`. */
export const UNLINK_USAGE = "usage: repo unlink <name> | --all";

export const USAGE =
  "usage: repo link <name> | repo link status | repo link push | repo link --pre-push; repo unlink <name> | --all";

export const NO_LINKS = "No links; every package comes from npm.";
export const NOT_INSTALLED = "(not installed)";
export const NPM_NONE = "none";
export const NPM_UNKNOWN = "unknown";
export const NEVER = "never";

export const LINK_OBJECT_ERROR = 'must be an object like { paths: { "@acme/ui": "../ui" }, push: "block" }';
export const LINK_PATHS_ERROR = 'must be an object like { "@acme/ui": "../ui" }';
export const LINK_PATH_ERROR = "must be a path like ../ui, relative to the repo root";
export const LINK_PUSH_ERROR = 'must be "block" or "allow"';

/** What the push check does while a public package depends on a linked one: refuse it, or warn and let it go. */
export const LINK_PUSH = ["block", "allow"] as const;

/** One of `LINK_PUSH`. */
export type LinkPush = (typeof LINK_PUSH)[number];

/** The push check when the config sets no `link.push`: refuse. */
export const DEFAULT_LINK_PUSH: LinkPush = "block";

/** The line for a link that worked: the package and version, where it came from, and the npm version it replaced. */
export function linkedLine(name: string, version: string, from: string): string {
  return `linked ${name} ${version} from ${from}`;
}

/** The suffix of that line naming the npm version the swap replaced. */
export function npmHad(npm: string): string {
  return ` (npm had ${npm})`;
}

/** The line that says how to undo a link. */
export function undoLine(name: string): string {
  return `${name} is linked; \`bun repo unlink ${name}\` puts npm back`;
}

/** The line for a link taken out. */
export function unlinkedLine(name: string, npm: string): string {
  return `unlinked ${name}: back on npm ${npm}`;
}

/** The error for a name no sibling publishes. */
export function noSibling(main: string, name: string): string {
  return [
    `no sibling of ${main} publishes "${name}";`,
    "clone it beside this checkout, or map it in repo.config.ts `link.paths`",
  ].join(" ");
}

/** The error for a sibling dir that has no package this repo uses. */
export function publishesNothing(dir: string): string {
  return `${dir} publishes nothing this repo depends on`;
}

/** The error for a mapped checkout that lacks the package. */
export function notPublished(dir: string, name: string): string {
  return `${dir} does not publish ${name}; fix \`link.paths\` in repo.config.ts`;
}

/** The error for a sibling that cannot build. */
export function siblingNoInstall(dir: string): string {
  return `${dir} has no node_modules, so its prepack cannot build; run \`bun install\` there`;
}

/** The error for a checkout with nothing to link into. */
export function noInstall(dir: string): string {
  return `${dir} has no node_modules; run \`bun install\` there`;
}

/** The error for a pack that failed, with the pack's own output indented under it. */
export function packFailed(name: string, output: string): string {
  return `${name} failed to pack; node_modules keeps the last good copy:\n  ${output.replaceAll("\n", "\n  ")}`;
}

/** The error for an install that failed after the links were dropped. */
export function installFailed(code: number): string {
  return `bun install failed (exit ${code}); node_modules may still hold the linked copy:`;
}

/** The error for a state file that does not parse. */
export function badState(file: string, why: string): string {
  return `${file} is not a valid link state (${why}); delete it to reset`;
}

/** The warning for a dependency of a linked package that this checkout lacks or holds outside its range. */
export function needsDependency(name: string, dep: string, range: string): string {
  return `warning: ${name} needs ${dep} ${range}, this checkout`;
}

/** What follows that warning: the version the checkout holds, or that it holds none. */
export function checkoutHolds(have: string | null): string {
  return have === null ? "does not install it" : `has ${have}`;
}

/** The line for a link put back after an install. */
export function relinkedLine(name: string, version: string, from: string): string {
  return `repo link: relinked ${name} ${version} from ${from}`;
}

/** The warning for a link whose source checkout is gone. */
export function goneLine(name: string, source: string): string {
  return `repo link: warning: ${source} is gone; ${name} stays on npm; \`bun repo unlink ${name}\` forgets it`;
}

/** The start of every line `repo link` prints for a user. */
export const LINK_PREFIX = "repo link:";

/** The prefix of a reapply warning. */
export const WARNING_PREFIX = "repo link: warning: ";

/** The refusal for a public package that depends on a linked one. */
export function refusedPush(pkg: string, linked: string): string {
  return `${pkg} is public and depends on linked ${linked}; \`bun repo unlink ${linked}\` before pushing`;
}

/** The warning for a public package that depends on a linked one, under `link.push: "allow"`. */
export function allowedPush(pkg: string, linked: string): string {
  return `${pkg} is public and depends on linked ${linked}; pushing since link.push is "allow"`;
}

/** The start of an alias dependency spec, `npm:<name>@<range>`. */
export const NPM_PREFIX = "npm:";

/** Under a source checkout: one file per consumer root that links one of its packages. */
export const DEPENDENTS_DIR = ".repo/tmp/dependents";
export const DEPENDENTS_VERSION = 1;
export const HASH_LENGTH = 16;

/** The warning for a dependents file that does not parse; the file is skipped. */
export function badDependent(file: string, why: string): string {
  return `repo link: warning: ${file} is not a valid dependents file (${why}); skipped`;
}

/** What `repo link push` prints when no dependents are recorded. */
export const NO_DEPENDENTS = "No repo on this machine links this checkout.";

/** Under the source checkout: where a push packs, removed after. */
export const PUSH_TMP = ".repo/tmp/push";

/** The line for a package pushed into one dependent. */
export function pushedLine(name: string, version: string, root: string): string {
  return `repo link: pushed ${name} ${version} to ${root}`;
}

/** The warning for a dependent that is gone or no longer links the package; its record is dropped. */
export function droppedLine(root: string, name: string): string {
  return `${WARNING_PREFIX}${root} is gone or no longer links ${name}; dropped it`;
}

/** The warning for a dependent whose install failed. */
export function pushFailedLine(name: string, root: string, why: string): string {
  return `${WARNING_PREFIX}${name} failed to install in ${root}; it keeps the last good copy: ${why}`;
}

/** The warning for a main branch that moved while the main checkout does not hold it clean. */
export function notCleanLine(main: string): string {
  return `${WARNING_PREFIX}main moved but ${main} does not have it checked out clean; pushed nothing`;
}

/** The header of the dependents section of `repo link status`. */
export function dependentsHeader(count: number): string {
  return count === 1 ? "1 dependent links this checkout:" : `${count} dependents link this checkout:`;
}

/** One dependent's row in `repo link status`. */
export function dependentRow(
  row: { root: string; name: string; synced: string },
  widths: { root: number; name: number },
): string {
  return `  ${row.root.padEnd(widths.root)}  ${row.name.padEnd(widths.name)}  synced ${row.synced}`;
}
