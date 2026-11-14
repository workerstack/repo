import { isSemverRange, resolvedVersion } from "./link-dependencies.ts";
import { installedDir, type Manifest } from "./link-installed.ts";
import { checkoutHolds, needsDependency } from "./link.constants.ts";

/** One warning per dependency or required peer the linked copy does not resolve, or resolves outside its range. */
export function depWarnings(root: string, manifest: Manifest): string[] {
  const optional = manifest.peerDependenciesMeta ?? {};

  const wanted = [
    ...Object.entries(manifest.dependencies ?? {}),
    ...Object.entries(manifest.peerDependencies ?? {}).filter(([dep]) => optional[dep]?.optional !== true),
  ];

  const copy = installedDir(root, manifest.name);
  const warnings: string[] = [];

  for (const [dep, range] of wanted) {
    if (!isSemverRange(range)) continue;
    const installed = resolvedVersion(copy, root, dep);

    if (installed === null || !Bun.semver.satisfies(installed, range))
      warnings.push(`${needsDependency(manifest.name, dep, range)} ${checkoutHolds(installed)}`);
  }

  return warnings;
}
