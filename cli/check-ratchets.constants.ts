/** The names `repo check`'s ratchets share. */

/** Where the coverage floors live unless the config says otherwise. */
export const DEFAULT_FLOORS = "coverage-floors.json";
/** Where the mutation floors live unless the config says otherwise. */
export const DEFAULT_MUTATION_FLOORS = "mutation-floors.json";
/** The git remote a clone's default branch is read from. */
export const ORIGIN = "origin";
/** The branch names tried when the current branch is the only one left. */
export const COMMON_BRANCHES = ["main", "master"] as const;
/** The `git diff --name-status` letter of a rename. */
export const RENAME = "R";
/** Separates the columns of `git diff --name-status`. */
export const TAB = "\t";
/** Separates the lines of git's output. */
export const NEWLINE = "\n";
/** What `defaultBranch` names when no branch is checked out. */
export const DETACHED = "HEAD";
/** The columns of a rename in `git diff --name-status`: the status, the old path and the new one. */
export const RENAME_COLUMNS = 3;
