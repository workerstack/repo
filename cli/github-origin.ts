import { GITHUB_REMOTE } from "./github.constants.ts";
import { runGit } from "./sync/standards.ts";

/** `owner/repo` of a github.com remote URL, https or ssh; null for any other URL. */
export function parseSlug(url: string): string | null {
  const match = GITHUB_REMOTE.exec(url.trim());

  if (match === null) return null;
  const [, owner, repo] = match;

  return `${owner}/${repo}`;
}

/** `owner/repo` of the checkout's `origin`; null without an origin or with one that is not on github.com. */
export function originSlug(cwd: string): string | null {
  const remote = runGit(cwd, ["remote", "get-url", "origin"]);

  return remote.status === 0 ? parseSlug(remote.stdout) : null;
}
