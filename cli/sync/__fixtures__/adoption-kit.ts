// What the adoption suites share: a hand-written AGENTS.md, the stop line sync prints and the tracked files.
import { git } from "./copied-install.ts";

/** A hand-written AGENTS.md. */
export const RULE = "# Team rules\n\nAlways run the linter.\n";

/** The stop line for a file of the consumer's own where sync generates. */
export const STOP = (rel: string): string =>
  `repo sync: ${rel} is yours and would be ignored; move it under .repo/ (see node_modules/@workerstack/repo/references/map.md) or delete it, then run \`bun repo sync\`\n`;

/** The files git tracks in `root`. */
export const tracked = (root: string): string[] => git(root, "ls-files").split("\n").filter(Boolean);
