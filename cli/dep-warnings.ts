import { installedDir, readVersion, type Manifest } from "./link-installed.ts";
import { checkoutHolds, needsDependency } from "./link.constants.ts";

/** npm:, file:, git and URL specifiers are not semver ranges, so they are not judged. */
function isSemverRange(range: string): boolean {
  return !range.includes(":") && !range.includes("/");
}

/** One warning per dependency or required peer the checkout lacks or holds at a version outside its range. */
export function depWarnings(root: string, manifest: Manifest): string[] {
  const optional = manifest.peerDependenciesMeta ?? {};

  const wanted = [
    ...Object.entries(manifest.dependencies ?? {}),
    ...Object.entries(manifest.peerDependencies ?? {}).filter(([dep]) => optional[dep]?.optional !== true),
  ];

  const warnings: string[] = [];

  for (const [dep, range] of wanted) {
    if (!isSemverRange(range)) continue;
    const installed = readVersion(installedDir(root, dep));

    if (installed === null || !Bun.semver.satisfies(installed, range))
      warnings.push(`${needsDependency(manifest.name, dep, range)} ${checkoutHolds(installed)}`);
  }

  return warnings;
}
