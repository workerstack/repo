export const FLAG_CHECK: string = "--check";
export const OPTION_PREFIX: string = "-";
export const EXIT_FAIL: number = 1;
export const EXIT_USAGE: number = 2;

/** Registry fetches in flight at once. */
export const CONCURRENCY: number = 8;

/** The narrowest the table's location column is. */
export const WHERE_MIN: number = 21;
export const COLUMN_GAP: number = 2;
export const INDENT: string = "  ";
export const ARROW: string = "→";
export const MAJOR_MARK: string = "major";
export const ROOT_FILE: string = "package.json";
export const POSIX: string = "/";
export const CATALOG: string = "catalog";
export const CATALOGS: string = "catalogs";
export const WORKSPACES: string = "workspaces";
export const PEER_FIELD: string = "peerDependencies";
export const MAJOR_SEPARATOR: string = ".";
export const PLAIN: RegExp = /^[\^~]?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;

/** A protocol (`catalog:`, `workspace:`, `git+ssh://`) or a `user/repo` shorthand. */
export const PREFIX: RegExp = /^[\^~]/;
export const PROTOCOL: RegExp = /[:/]/;
export const TAG: RegExp = /^[A-Za-z][\w.-]*$/;
export const WILDCARD: RegExp = /^[xX]$/;

export const USAGE: string = "usage: repo update [--check] [<name>|@scope/*…]";
export const NOT_ON_REGISTRY: string = "is not on the registry";
export const NO_LATEST: string = "has no latest on the registry";
export const FOLLOW_UP: string = "run `bun repo update` to write them, or `bun repo update <name>` for some";

export function prefixed(message: string): string {
  return `repo update: ${message}`;
}

export function nothingDepends(name: string): string {
  return `nothing here depends on "${name}"`;
}

export function noAnswer(host: string, name: string, why: string): string {
  return `${host} did not answer for ${name} (${why}); nothing was written`;
}

export function installFailed(code: number): string {
  return (
    `bun install failed (exit ${code}); the manifests hold the new versions, ` +
    "so run `bun install` once it is fixed:"
  );
}

export function formatFailed(files: string): string {
  return `could not format ${files}; the new versions are installed so run \`bun repo fmt\` once it is fixed:`;
}

export function behindHeader(behind: number, checked: number): string {
  return `${behind} behind of ${checked} checked:`;
}

export function allCurrent(checked: number): string {
  return `every dependency is on latest (${checked} checked)`;
}

export function skippedLine(reasons: string[]): string {
  return `skipped ${reasons.length}: ${reasons.join("; ")}`;
}

export function rangeReason(name: string, where: string, spec: string): string {
  return `${name} in ${where} is "${spec}", not a plain version`;
}

export function onLatest(name: string, spec: string): string {
  return `${name} is on latest (${spec})`;
}

export function updatedHeader(count: number): string {
  return `updated ${count}: `;
}

export function catalogSaid(scope: string | null): string {
  return scope === null ? "the catalog" : `the ${scope} catalog`;
}

export function catalogWhere(scope: string | null): string {
  return scope === null ? CATALOG : `${CATALOG}:${scope}`;
}

export const JSON_INDENT: number = 2;

export const UPDATE_SUMMARY: string =
  "List and bump outdated catalog and manifest versions (--check: list only; names or @scope/* narrow it)";

/** The lines of an install's output that `repo sync --postinstall` printed. */
export const SYNC_PREFIX: string = "repo sync: ";

/** The pattern the packages that ship a CHANGELOG.md match. */
export const CHANGES_SCOPE: string = "@workerstack/*";
export const CHANGELOG_FILE: string = "CHANGELOG.md";
export const MODULES_DIR: string = "node_modules";

export function changesHeader(name: string, from: string, to: string): string {
  return `${name} ${from} ${ARROW} ${to}:`;
}

export function noChangelog(header: string, where: string): string {
  return `${header} no ${CHANGELOG_FILE} in ${where}`;
}

export function noSections(header: string): string {
  return `${header} no ${CHANGELOG_FILE} sections between them`;
}
