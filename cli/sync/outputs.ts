import fs from "node:fs";
import path from "node:path";

import type { ResolvedConfig } from "../config.ts";
import { LESSONS_DIR, INDEX_NAME, lessonProblems, renderLessonsIndex } from "../scripts/lessons.ts";
import { lines } from "../scripts/lines.ts";
import { DEPENDENCY_DIR } from "./available.constants.ts";
import { available } from "./available.ts";
import { githubFiles } from "./github-files.ts";
import { hasOwnedHeader } from "./header.ts";
import { mapSections } from "./maps.ts";
import { nightly } from "./nightly.ts";
import { readme } from "./readme.ts";
import { type Region, type RegionResult, syntaxOf, writeRegions } from "./region.ts";
import { releaseWorkflow } from "./release-workflow.ts";
import { release } from "./release.ts";
import { rust } from "./rust.ts";
import { isSelfName } from "./stock.ts";
import { renderTrees } from "./trees.ts";
import { turbo } from "./turbo.ts";
import { vitestProjects } from "./vitest-projects.ts";
import type { PackageJson, Workspace, WorkspacePackage } from "./workspace.ts";

/**
 * One path repo sync owns, at a root-relative POSIX path. A `link` is a directory symlink (a junction on win32)
 * to `target`, absolute or relative to the link's directory. `tracked` says whether the path is committed.
 * `managed` says who owns the text: `whole` is sync's alone (marked generated, read-only on disk: mode 0444, 0555 for
 * an `executable` one on POSIX); `block` is a file the user also writes, of which sync owns a marked section, left
 * writable. `repairs` are what sync did to the user's text of a block file to get `content`, or why it left the file as
 * is, one line each; sync prints them under the file's path.
 */
export type Output =
  | {
      kind: "file";
      path: string;
      content: string;
      tracked: boolean;
      managed: Managed;
      executable?: boolean;
      repairs?: readonly string[];
    }
  | { kind: "link"; path: string; target: string; tracked: boolean; managed: Managed };
export type Managed = "whole" | "block";
/** What a generator sees; `read` returns a root-relative file's text, or null when it is missing. */
export type SyncContext = {
  root: string;
  config: ResolvedConfig;
  workspace: Workspace;
  read(rel: string): string | null;
};
/** Computes outputs from the context alone; it never writes, so sync can validate everything first. */
export type Generator = (ctx: SyncContext) => { outputs: Output[]; errors: string[] };

const BUNFIG_PATH = "bunfig.toml";
// auto = "disable": with no node_modules above a script, bun would fetch a missing import from the registry.
const BUNFIG = `[install]\nlinker = "hoisted"\nauto = "disable"\n`;

const INDEX_PATH = "references/INDEX.md";
const INDEX_NEW = "# References\n";
const STACK_SCOPE = "@workerstack/";
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

/** bunfig.toml, refusing to replace one that lacks sync's header. */
export const bunfig: Generator = (ctx) => {
  const existing = ctx.read(BUNFIG_PATH);
  if (existing !== null && !hasOwnedHeader(existing)) {
    return { errors: [`${BUNFIG_PATH} is hand-written; delete it so repo sync can own it`], outputs: [] };
  }
  return {
    errors: [],
    outputs: [{ content: BUNFIG, kind: "file", managed: "whole", path: BUNFIG_PATH, tracked: true }],
  };
};

/**
 * The repo:packages, repo:stack and (with the references index installed) repo:available sections of references/INDEX.md, under the docs pack; in this repo also the
 * repo:skills and repo:refs maps of its own skills and references.
 */
export const index: Generator = (ctx) => {
  if (!ctx.config.packs.includes("docs")) return { errors: [], outputs: [] };

  const errors: string[] = [];
  const sections: Region[] = [];
  const packageIndexes: Output[] = [];
  const { packages } = ctx.workspace;
  if (packages.length > 0) {
    const entries: string[] = [];
    for (const { dir, manifest } of packages) {
      const rel = `${dir}/${INDEX_PATH}`;
      const text = ctx.read(rel);
      if (text === null) {
        errors.push(`${dir} has no ${INDEX_PATH}; every workspace package needs one`);
        continue;
      }
      const title = lines(text)
        .map((line) => line.trim())
        .find((line) => line !== "");
      const description = title === undefined ? "" : `: ${title.replace(/^# /, "")}`;
      entries.push(`- [${manifest.name || dir}](../${rel})${description}`);
      const deps = depsLines(dir, manifest, packages).join("\n");
      packageIndexes.push(sharedFile(rel, writeRegions(text, syntaxOf(rel), [section("deps", deps)])));
    }
    sections.push(section("packages", entries.join("\n")));
  }
  const stack = stackNames(ctx.workspace).map((name) => `- [${name}](../node_modules/${name}/${INDEX_PATH})`);
  sections.push(section("stack", stack.join("\n")), ...availableSections(ctx));
  if (isSelfName(ctx.workspace.manifest.name)) {
    const maps = mapSections(ctx.root);
    sections.push(section("skills", maps.skills), section("refs", maps.refs));
  }

  if (errors.length > 0) return { errors, outputs: [] };
  const text = writeRegions(ctx.read(INDEX_PATH) ?? INDEX_NEW, syntaxOf(INDEX_PATH), sections);
  return { errors: [], outputs: [sharedFile(INDEX_PATH, text), ...packageIndexes] };
};

/** An INDEX region, appended at the bottom when the file has no marker for it. */
function section(name: string, body: string): Region {
  return { body, name, place: "bottom" };
}

/** The tracked block output at `rel` holding `result`'s text, with its repairs when it has any. */
function sharedFile(rel: string, { text, repairs }: RegionResult): Output {
  const output: Output = { content: text, kind: "file", managed: "block", path: rel, tracked: true };
  return repairs.length === 0 ? output : { ...output, repairs };
}

/**
 * The repo:deps lines of the INDEX of package `dir`: one link per dependency (any field) that is a workspace package,
 * then one per other `@workerstack/*` package, each group sorted by name. A workspace package wins over the installed
 * one, so a workspace `@workerstack/x` is linked in place.
 */
function depsLines(dir: string, manifest: PackageJson, packages: readonly WorkspacePackage[]): string[] {
  const names = new Set(DEPENDENCY_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {})));
  const inWorkspace = new Map(
    packages.flatMap((pkg) => (pkg.manifest.name === undefined ? [] : [[pkg.manifest.name, pkg.dir] as const])),
  );
  const link = (name: string, target: string) =>
    `- [${name}](${path.posix.relative(`${dir}/references`, `${target}/${INDEX_PATH}`)})`;
  const workspace = [...names].filter((name) => inWorkspace.has(name)).sort();
  const stack = [...names].filter((name) => !inWorkspace.has(name) && name.startsWith(STACK_SCOPE)).sort();
  return [
    ...workspace.map((name) => link(name, inWorkspace.get(name) as string)),
    ...stack.map((name) => link(name, `${DEPENDENCY_DIR}${name}`)),
  ];
}

/** Under the agents pack, `.repo/lessons/INDEX.md` for the lessons under `.repo/lessons`, and one error per lesson that breaks the format. */
export const lessons: Generator = (ctx) => {
  if (!ctx.config.packs.includes("agents")) return { errors: [], outputs: [] };
  const errors = lessonProblems(ctx.root);
  if (!fs.existsSync(path.join(ctx.root, LESSONS_DIR))) return { errors, outputs: [] };
  const output: Output = {
    content: renderLessonsIndex(ctx.root),
    kind: "file",
    managed: "whole",
    path: `${LESSONS_DIR}/${INDEX_NAME}`,
    tracked: true,
  };
  return { errors, outputs: [output] };
};

/** The agent trees of the enabled hosts, under the agents pack; a failed render is its errors and no outputs. */
export const trees: Generator = (ctx) => {
  if (!ctx.config.packs.includes("agents")) return { errors: [], outputs: [] };
  const result = renderTrees(ctx);
  return result.ok ? { errors: [], outputs: result.outputs } : { errors: result.errors, outputs: [] };
};

/** Every generator, in the order sync runs and reports them. */
export const GENERATORS: readonly Generator[] = [
  bunfig,
  index,
  readme,
  lessons,
  trees,
  release,
  nightly,
  releaseWorkflow,
  githubFiles,
  vitestProjects,
  turbo,
  rust,
];

/** The repo:available section, or none when the references index is not installed. */
function availableSections(ctx: SyncContext): Region[] {
  const body = available(ctx.read, installedNames(ctx.workspace));
  return body === null ? [] : [section("available", body)];
}

/** Every name the workspace has: the stack dependencies, the root and each package. */
function installedNames(workspace: Workspace): Set<string> {
  const own = [workspace.manifest, ...workspace.packages.map((pkg) => pkg.manifest)].flatMap((m) => m.name ?? []);
  return new Set([...stackNames(workspace), ...own]);
}

/** Every `@workerstack/*` dependency name of the root and its packages, deduped and sorted. */
function stackNames(workspace: Workspace): string[] {
  const names = new Set<string>();
  for (const manifest of [workspace.manifest, ...workspace.packages.map((pkg) => pkg.manifest)]) {
    for (const field of DEPENDENCY_FIELDS) {
      for (const name of Object.keys(manifest[field] ?? {})) if (name.startsWith(STACK_SCOPE)) names.add(name);
    }
  }
  return [...names].sort();
}
