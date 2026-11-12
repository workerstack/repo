import fs from "node:fs";
import path from "node:path";

import { CALL_SEPARATOR, QUOTED_SPAN } from "./check-manifests.constants.ts";
import { isRecord, isString } from "./json.ts";
import type { PackageJson, Workspace } from "./sync/workspace.ts";

const BUN_PIN = /^bun@\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/**
 * `repo check`'s manifest lines, one per problem: the root first, then each workspace package by directory.
 * A root with `workspaces` is not a package, so it needs `private` and `packageManager` but not `sideEffects`.
 */
export function checkManifests({ root, manifest, packages }: Workspace): string[] {
  const lines: string[] = [];
  const isMonorepo = manifest.workspaces !== undefined;

  if (fs.existsSync(path.join(root, "package.json"))) {
    lines.push(
      ...privateLines("package.json", manifest),
      ...(isMonorepo ? [] : sideEffectsLines("package.json", manifest)),
      ...packageManagerLines(manifest),
      ...chainedScriptLines(manifest),
    );
  }

  for (const pkg of packages) {
    const file = `${pkg.dir}/package.json`;
    lines.push(...privateLines(file, pkg.manifest), ...sideEffectsLines(file, pkg.manifest));
  }

  return lines;
}

function privateLines(file: string, manifest: PackageJson): string[] {
  const lines: string[] = [];

  if (manifest.private === undefined) lines.push(`${file}: "private" is missing; set true, or false to publish it`);

  if (manifest.private === true && manifest.version !== undefined)
    lines.push(`${file}: private packages have no "version"; delete it`);

  return lines;
}

/** A package, unlike a monorepo root, must say it has no side effects. */
function sideEffectsLines(file: string, { sideEffects }: PackageJson): string[] {
  if (sideEffects === false) return [];

  if (sideEffects === undefined) return [`${file}: "sideEffects" is missing; set it to false`];

  return [`${file}: "sideEffects" is ${JSON.stringify(sideEffects)}; set it to false and import CSS from an app entry`];
}

function packageManagerLines({ packageManager }: PackageJson): string[] {
  if (packageManager === undefined)
    return [`package.json: "packageManager" is missing; set it to "bun@${Bun.version}"`];

  if (isString(packageManager) && BUN_PIN.test(packageManager)) return [];

  return [
    `package.json: "packageManager" is ${JSON.stringify(packageManager)}; ` +
      `pin an exact version like "bun@${Bun.version}"`,
  ];
}

function chainedScriptLines({ scripts }: PackageJson): string[] {
  const lines: string[] = [];
  const entries = isRecord(scripts) ? Object.entries(scripts) : [];

  for (const [name, command] of entries) {
    const calls = isString(command) ? toolCalls(command) : 0;

    if (calls <= 1) continue;
    lines.push(
      `package.json: "${name}" chains ${calls} tool calls with "&&" or ";"; make it one call, such as "repo ci"`,
    );
  }

  return lines;
}

/** The non-empty segments of `command` split on `&&` and `;` outside quotes; `||` and `|` do not split. */
function toolCalls(command: string): number {
  return command
    .replace(QUOTED_SPAN, "x")
    .split(CALL_SEPARATOR)
    .filter((segment) => segment.trim() !== "").length;
}
