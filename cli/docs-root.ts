import fs from "node:fs";
import path from "node:path";

import { BUILD_SCRIPT } from "./docs-examples.constants.ts";
import { checkExamples, blocksOf, type Block, type ExampleTools } from "./docs-examples.ts";
import { exportFindings, isPublic } from "./docs-exports.ts";
import { linkFindings, listedFiles, unlistedFindings } from "./docs-index.ts";
import { tarballFindings, type Pack, type Wanted } from "./docs-tarball.ts";
import { INDEX_FILE, MARKDOWN_EXT, REFERENCES_DIR, under } from "./docs.constants.ts";
import type { PackageJson } from "./sync/workspace.ts";

/** A folder with a `references/INDEX.md`: `dir` is root-relative with POSIX separators, "" for the repo root. */
export type DocRoot = { dir: string; manifest: PackageJson };

/** What one doc root's checks found and counted. */
export type RootReport = { findings: string[]; references: number; examples: number; exports: number; packed: boolean };

/** The tools a doc root's checks run. */
export type DocsTools = ExampleTools & { pack: Pack };

/** The doc roots under `root`: the root and each package, kept when it holds `references/INDEX.md`. */
export function docRootsOf(root: string, roots: readonly DocRoot[]): DocRoot[] {
  return roots.filter(({ dir }) => fs.existsSync(path.join(root, under(dir, `${REFERENCES_DIR}/${INDEX_FILE}`))));
}

/** The `.md` files under the doc root's `references/`, root-relative and sorted, with their text. */
function readReferences(root: string, dir: string): Map<string, string> {
  const base = under(dir, REFERENCES_DIR);

  const found = fs
    .readdirSync(path.join(root, base), { encoding: "utf8", recursive: true })
    .map((entry) => `${base}/${entry.replaceAll("\\", "/")}`)
    .filter((file) => file.endsWith(MARKDOWN_EXT))
    .toSorted();

  return new Map(found.map((file) => [file, fs.readFileSync(path.join(root, file), "utf8")]));
}

function hasBuildScript(manifest: PackageJson): boolean {
  const { scripts } = manifest;

  return typeof scripts === "object" && scripts !== null && BUILD_SCRIPT in scripts;
}

/** Index and link findings, and the files each INDEX lists. */
function indexLines(root: string, { dir, manifest }: DocRoot, texts: ReadonlyMap<string, string>) {
  function exists(rel: string) {
    return fs.existsSync(path.join(root, rel));
  }

  const listedBy = new Map<string, Set<string>>();
  const wanted: Wanted[] = [];
  const prefix = `${under(dir, REFERENCES_DIR)}/`;

  for (const [file, text] of texts) {
    if (path.posix.basename(file) !== INDEX_FILE) continue;

    const listed = listedFiles({ name: manifest.name ?? "", path: file, text }, exists).filter((one) =>
      one.path.startsWith(prefix),
    );

    listedBy.set(file, new Set(listed.map((one) => one.path)));
    wanted.push({ file, index: file }, ...listed.map((one) => ({ file: one.path, index: file })));
  }

  const lines = [
    ...unlistedFindings([...texts.keys()], `${prefix}${INDEX_FILE}`, listedBy),
    ...[...texts].flatMap(([file, text]) => linkFindings(file, text, exists)),
  ];

  return { lines, wanted };
}

/** Every check for one doc root; the tarball and export checks only for a public manifest. */
export function checkDocRoot(root: string, docRoot: DocRoot, tools: DocsTools): RootReport {
  const { dir, manifest } = docRoot;
  const texts = readReferences(root, dir);
  const { lines, wanted } = indexLines(root, docRoot, texts);
  const blocks: Block[] = [...texts].flatMap(([file, text]) => blocksOf(dir, file.slice(under(dir, "").length), text));
  const name = manifest.name ?? "";
  const ctx = { build: hasBuildScript(manifest) && name !== "", dir, name, root };

  const report: RootReport = {
    examples: blocks.length,
    exports: 0,
    findings: [...lines, ...checkExamples(ctx, blocks, tools)],
    packed: false,
    references: texts.size,
  };

  if (!isPublic(manifest)) return report;
  const exported = exportFindings(dir, manifest, [...texts.values()].join("\n"));
  const unique = wanted.filter((one, at) => wanted.findIndex((other) => other.file === one.file) === at);
  report.findings.push(...exported.findings, ...tarballFindings(dir, unique, () => tools.pack(path.join(root, dir))));

  return { ...report, exports: exported.checked, packed: true };
}
