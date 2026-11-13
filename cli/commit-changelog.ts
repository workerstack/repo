import type { Owner } from "./tdd-scope.ts";

const CHANGELOG = "CHANGELOG.md";

/** Commit types that change what a user of a package sees. */
const USER_FACING: readonly string[] = ["feat", "fix", "perf"];

/** What a message says about itself, as far as the changelog rule reads it. */
export type Kind = { type: string; breaking: boolean };

/**
 * The problem when a feat, fix, perf or breaking commit stages a file of a public package but not that package's
 * CHANGELOG.md; one per package that is missing its entry.
 */
export function changelogProblems(kind: Kind, staged: readonly string[], owners: (file: string) => Owner): string[] {
  if (!kind.breaking && !USER_FACING.includes(kind.type)) return [];
  const what = kind.breaking ? "a breaking change" : `a ${kind.type}`;

  const dirs = [
    ...new Set(
      staged
        .map(owners)
        .filter((owner) => owner.public)
        .map((owner) => owner.dir),
    ),
  ];

  return dirs
    .map((dir) => ({ dir, file: dir === "." ? CHANGELOG : `${dir}/${CHANGELOG}` }))
    .filter(({ file }) => !staged.includes(file))
    .map(({ dir, file }) => {
      const flag = dirs.length > 1 ? ` --dir ${dir}` : "";

      return `${what} changes what users see; run bun repo changelog add <section> "<text>"${flag} for ${file}`;
    });
}
