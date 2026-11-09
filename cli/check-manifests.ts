import fs from "node:fs";
import path from "node:path";
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
    lines.push(...packageLines("package.json", manifest, !isMonorepo), ...packageManagerLines(manifest));
  }
  for (const pkg of packages) lines.push(...packageLines(`${pkg.dir}/package.json`, pkg.manifest, true));
  return lines;
}

function packageLines(file: string, manifest: PackageJson, needsSideEffects: boolean): string[] {
  const lines: string[] = [];
  if (manifest.private === undefined) lines.push(`${file}: "private" is missing; set true, or false to publish it`);
  if (manifest.private === true && manifest.version !== undefined) {
    lines.push(`${file}: private packages have no "version"; delete it`);
  }
  if (needsSideEffects && manifest.sideEffects !== false) {
    lines.push(
      manifest.sideEffects === undefined
        ? `${file}: "sideEffects" is missing; set it to false`
        : `${file}: "sideEffects" is ${JSON.stringify(manifest.sideEffects)}; set it to false and import CSS from an app entry`,
    );
  }
  return lines;
}

function packageManagerLines({ packageManager }: PackageJson): string[] {
  if (packageManager === undefined) {
    return [`package.json: "packageManager" is missing; set it to "bun@${Bun.version}"`];
  }
  if (typeof packageManager === "string" && BUN_PIN.test(packageManager)) return [];
  return [
    `package.json: "packageManager" is ${JSON.stringify(packageManager)}; pin an exact version like "bun@${Bun.version}"`,
  ];
}
