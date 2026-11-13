/** The one place that names where the package keeps agent files: `.repo/<dir>` at a checkout root. */
import path from "node:path";

import { IGNORED_DIRS, RED_PROOF, REPO, SCRATCH, STATE, WORK_DIRS } from "./repo-dirs.constants.ts";
import { relInside } from "./scripts/gate-paths.ts";

export { IGNORED_DIRS, RED_PROOF, REPO, SCRATCH, STATE, WORK_DIRS } from "./repo-dirs.constants.ts";

export type RepoDir = (typeof IGNORED_DIRS)[number];

/** Entries of `.repo/tmp` that belong to one checkout and never route to the root. */
export const CHECKOUT_STATE: ReadonlySet<string> = /* @__PURE__ */ new Set(["sync.json", "stage"]);

/** Dirs that live under `.repo/tmp`. */
export const STATE_DIRS: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "sessions",
  "orchestrator-logs",
  "stash",
  "browser",
  "listen",
  "speak",
  "ci",
  "mutation",
  "tsbuildinfo",
  "blob",
]);

const STATE_SET: ReadonlySet<string> = /* @__PURE__ */ new Set<string>([STATE]);

const IGNORED_SET: ReadonlySet<string> = /* @__PURE__ */ new Set<string>(IGNORED_DIRS);

/** `<root>/.repo/<segs>`. */
export function repoPath(root: string, ...segs: string[]): string {
  return path.join(root, REPO, ...segs);
}

/** Segments of `abs` below `<root>/.repo`, or null when it is not under it. */
function repoSegments(root: string, abs: string, p: typeof path): [string, ...string[]] | null {
  const rel = relInside(p.join(root, REPO), abs, p);

  return rel === null ? null : (rel.split("/") /* split yields at least one element */ as [string, ...string[]]);
}

/** True when `abs` is inside one of the ignored `.repo` dirs of `root`; callers pass canonical paths. */
export function isIgnoredRepoPath(root: string, abs: string, p: typeof path = path): boolean {
  const segs = repoSegments(root, abs, p);

  return segs !== null && IGNORED_SET.has(segs[0]);
}

/** True when a write to `abs` lands at the root's `.repo`; each checkout keeps its own `CHECKOUT_STATE`. */
export function routesToRoot(root: string, abs: string, p: typeof path = path): boolean {
  const segs = repoSegments(root, abs, p);

  if (segs === null || !IGNORED_SET.has(segs[0])) return false;

  const [top, entry] = segs;

  return !(STATE_SET.has(top) && entry !== undefined && CHECKOUT_STATE.has(entry));
}

/** The `.repo`-relative home, with `/`, of an entry that used to sit at `.tmp/repo/<name>`. */
export function oldTmpHome(name: string): string {
  if (WORK_DIRS.some((dir) => dir === name)) return name;

  if (STATE_DIRS.has(name) || name.startsWith(RED_PROOF)) return `${STATE}/${name}`;

  return `${SCRATCH}/${name}`;
}
