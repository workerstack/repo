import {
  ADVISORIES_URL,
  BUG_REPORT,
  BUG_REPORT_PATH,
  CODEOWNERS_PATH,
  CONTRIBUTING,
  CONTRIBUTING_PATH,
  GITHUB_REPOSITORY,
  ISSUE_CONFIG,
  ISSUE_CONFIG_PATH,
  MANIFEST_PATH,
  PULL_REQUEST,
  PULL_REQUEST_PATH,
  SECURITY,
  SECURITY_PATH,
} from "./github-files.constants.ts";
import { hasOwnedHeader } from "./header.ts";
import type { Generator, Output } from "./outputs.ts";

/** `owner/repo` from the manifest text's `repository` (object or string form), or null when it names no GitHub repository. */
function repositorySlug(manifest: string | null): string | null {
  if (manifest === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifest);
  } catch {
    return null;
  }
  const repository: unknown = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "repository") : null;
  const url: unknown =
    typeof repository === "object" && repository !== null ? Reflect.get(repository, "url") : repository;
  return typeof url === "string" ? (GITHUB_REPOSITORY.exec(url)?.[1] ?? null) : null;
}

/**
 * Under the release pack with a public root and a config `owner`, the six community-health files as tracked, whole
 * files sync stamps with its header; a hand-written one is refused. A root with no GitHub `repository` gets none, as
 * `repo check` reports that.
 */
export const githubFiles: Generator = (ctx) => {
  const { name, private: isPrivate } = ctx.workspace.manifest;
  const { owner } = ctx.config;
  if (!ctx.config.packs.includes("release") || name === undefined || isPrivate !== false || owner === undefined) {
    return { outputs: [], errors: [] };
  }
  const slug = repositorySlug(ctx.read(MANIFEST_PATH));
  if (slug === null) return { outputs: [], errors: [] };
  const advisories = ADVISORIES_URL.replace("%REPO%", slug);
  const files: [path: string, content: string][] = [
    [SECURITY_PATH, SECURITY.replace("%ADVISORIES%", advisories)],
    [CONTRIBUTING_PATH, CONTRIBUTING],
    [CODEOWNERS_PATH, `* @${owner.github}\n`],
    [PULL_REQUEST_PATH, PULL_REQUEST],
    [BUG_REPORT_PATH, BUG_REPORT],
    [ISSUE_CONFIG_PATH, ISSUE_CONFIG.replace("%ADVISORIES%", advisories)],
  ];
  const errors: string[] = [];
  const outputs: Output[] = [];
  for (const [path, content] of files) {
    const existing = ctx.read(path);
    if (existing !== null && !hasOwnedHeader(existing)) {
      errors.push(`${path} is hand-written; delete it so repo sync can own it`);
    } else outputs.push({ kind: "file", path, content, tracked: true, managed: "whole" });
  }
  return errors.length > 0 ? { outputs: [], errors } : { outputs, errors: [] };
};
