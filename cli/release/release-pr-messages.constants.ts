/** The result and refusal lines of `repo release` under the pull-request workflow. */

/** How a release hands back while its pull request waits on a person. */
const ONCE_MERGED = "run bun repo release again once it merges";

export function prOpened(url: string, tag: string): string {
  return `opened ${url} for ${tag}; ${ONCE_MERGED}`;
}

export function prNotMerged(url: string, tag: string): string {
  return `${url} for ${tag} is not merged yet; ${ONCE_MERGED}`;
}

export function aheadUnderPr(branch: string, ahead: number): string {
  const commits = ahead === 1 ? "commit" : "commits";

  return (
    `${branch} has ${ahead} ${commits} origin lacks; ` +
    `under the pull-request workflow it reaches ${branch} only through a pull request`
  );
}

export function manyReleaseBranches(branches: readonly string[]): string {
  return (
    `more than one release branch (${branches.join(", ")}); ` +
    "finish or remove all but one, then run bun repo release again"
  );
}
