/**
 * `repo check` under the release pack: the nightly mutation run needs Stryker and files to mutate, unless a Rust repo
 * has neither.
 */
import { loadConfig, type ResolvedConfig } from "./config.ts";
import { selectFiles } from "./mutate-files.ts";
import { INSTALL_HINT, STRYKER_CORE, STRYKER_RUNNER } from "./mutate.constants.ts";
import { runGit } from "./sync/standards.ts";
import { readWorkspace, type Workspace } from "./sync/workspace.ts";

/** What the nightly problems are judged from: the config, the workspace and the tracked files. */
export type NightlyInput = { config: ResolvedConfig; workspace: Workspace; tracked: readonly string[] };

/** One line per problem that would make the nightly mutation job fail every night; none without the release pack. */
export function nightlyProblems({ config, workspace, tracked }: NightlyInput): string[] {
  if (!config.packs.includes("release")) return [];
  const lines: string[] = [];
  const { dependencies = {}, devDependencies = {} } = workspace.manifest;
  function installed(name: string) {
    return name in dependencies || name in devDependencies;
  }
  const stryker = [STRYKER_CORE, STRYKER_RUNNER].every(installed);
  const globs = config.coverage.mutate;
  const hasMatches = selectFiles(tracked, globs).length > 0;
  const rustOnly = tracked.includes("Cargo.toml") && !stryker;
  if (!stryker && (hasMatches || !rustOnly))
    lines.push(`the release pack runs mutation tests nightly; ${INSTALL_HINT}`);

  if (!hasMatches && !rustOnly) {
    lines.push(
      `coverage.mutate (${globs.join(", ")}) matches no tracked file; set coverage.mutate in workerstack.config.ts`,
    );
  }
  return lines;
}

/**
 * `nightlyProblems` for the checkout at `root`; a config, manifest or listing that cannot be read is another check's
 * line.
 */
export async function checkNightlyAt(root: string): Promise<string[]> {
  const loaded = await loadConfig(root);
  const read = readWorkspace(root);
  const listed = runGit(root, ["ls-files", "-z", "--cached"]);
  if (!loaded.ok || !read.ok || listed.status !== 0) return [];
  const tracked = listed.stdout.split("\0").filter((file) => file !== "");
  return nightlyProblems({ config: loaded.config, tracked, workspace: read.workspace });
}
