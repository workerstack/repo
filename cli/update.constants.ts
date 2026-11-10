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

export const USAGE: string = "usage: repo update [--check] [<name>…]";
export const NOT_ON_REGISTRY: string = "is not on the registry";
export const NO_LATEST: string = "has no latest on the registry";
export const FOLLOW_UP: string = "run `bun repo update` to write them, or `bun repo update <name>` for some";

export const prefixed = (message: string): string => `repo update: ${message}`;
export const nothingDepends = (name: string): string => `nothing here depends on "${name}"`;
export const noAnswer = (host: string, name: string, why: string): string =>
  `${host} did not answer for ${name} (${why}); nothing was written`;
export const installFailed = (code: number): string =>
  `bun install failed (exit ${code}); the manifests hold the new versions, so run \`bun install\` once it is fixed:`;
export const formatFailed = (files: string): string =>
  `could not format ${files}; the new versions are installed so run \`bun repo fmt\` once it is fixed:`;
export const behindHeader = (behind: number, checked: number): string => `${behind} behind of ${checked} checked:`;
export const allCurrent = (checked: number): string => `every dependency is on latest (${checked} checked)`;
export const skippedLine = (reasons: string[]): string => `skipped ${reasons.length}: ${reasons.join("; ")}`;
export const rangeReason = (name: string, where: string, spec: string): string =>
  `${name} in ${where} is "${spec}", not a plain version`;
export const onLatest = (name: string, spec: string): string => `${name} is on latest (${spec})`;
export const updatedHeader = (count: number): string => `updated ${count}: `;
export const catalogSaid = (scope: string | null): string => (scope === null ? "the catalog" : `the ${scope} catalog`);
export const catalogWhere = (scope: string | null): string => (scope === null ? CATALOG : `${CATALOG}:${scope}`);
export const JSON_INDENT: number = 2;
export const UPDATE_SUMMARY: string =
  "List and bump outdated catalog and manifest versions (--check: list only; names narrow it)";
