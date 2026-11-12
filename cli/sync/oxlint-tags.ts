/** `lint.boundaries` checked against the workspace, and written as the options of `repo/boundaries`. */
import { CONFIG_FILE } from "../config.constants.ts";
import { type LintBoundaries } from "../config.ts";
import type { RuleSetting } from "./oxlint-rules.ts";
import type { Workspace } from "./workspace.ts";

const AT = `${CONFIG_FILE}: lint.boundaries`;

/** The names of the root and each workspace package, the ones a tag may name. */
function packageNames(workspace: Workspace): Set<string> {
  const manifests = [workspace.manifest, ...workspace.packages.map((pkg) => pkg.manifest)];

  return new Set(manifests.flatMap((manifest) => (manifest.name === undefined ? [] : [manifest.name])));
}

/**
 * One line per tag that names no workspace package, per allowed tag no package carries, per carried tag with no
 * `allow` entry, and per `allow` key no package carries: each would check nothing, or leave a package unjudged. No
 * `lint.boundaries`, no line.
 */
export function tagErrors(workspace: Workspace, boundaries: LintBoundaries | undefined): string[] {
  if (boundaries === undefined) return [];
  const names = packageNames(workspace);
  const carried = new Set(Object.values(boundaries.tags));
  const gone = Object.keys(boundaries.tags).filter((name) => !names.has(name));

  const unknown = Object.entries(boundaries.allow).flatMap(([tag, allowed]) =>
    allowed.filter((other) => !carried.has(other)).map((other) => ({ other, tag })),
  );

  const missing = [...carried].filter((tag) => !Object.hasOwn(boundaries.allow, tag));
  const uncarried = Object.keys(boundaries.allow).filter((tag) => !carried.has(tag));

  return [
    ...gone.map((name) => `${AT}.tags: ${JSON.stringify(name)} is not a workspace package`),
    ...unknown.map(
      ({ tag, other }) => `${AT}.allow.${tag}: ${JSON.stringify(other)} is not a tag lint.boundaries.tags gives`,
    ),
    ...missing.map((tag) => `${AT}.allow: tag ${JSON.stringify(tag)} has no entry; list the tags it may import, or []`),
    ...uncarried.map((tag) => `${AT}.allow.${tag}: no package carries tag ${JSON.stringify(tag)}; drop the entry`),
  ];
}

/** `repo/boundaries` as the generated config sets it: with the tags as its options when the config sets them. */
export function boundariesSetting(
  boundaries: LintBoundaries | undefined,
): Partial<Record<"repo/boundaries", RuleSetting>> {
  if (boundaries === undefined) return {};

  return { "repo/boundaries": ["error", { allow: boundaries.allow, tags: boundaries.tags }] };
}
