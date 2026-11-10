/**
 * `repo docs [--check]`: checks the references of the root and of each workspace package that has a
 * `references/INDEX.md` (listing, links, exports, examples, tarball). Without `--check` it runs sync first.
 */
import { findRoot } from "./config.ts";
import { docsIo, type DocsIo } from "./docs-io.ts";
import { checkDocRoot, docRootsOf, type RootReport } from "./docs-root.ts";
import { DOCS_USAGE, EXIT_FAILED, EXIT_USAGE, FLAG_CHECK, okLine } from "./docs.constants.ts";
import { readWorkspace } from "./sync/workspace.ts";

function total(reports: readonly RootReport[]): Parameters<typeof okLine>[0] {
  const sum = (pick: (report: RootReport) => number) => reports.reduce((all, report) => all + pick(report), 0);
  return {
    references: sum((report) => report.references),
    examples: sum((report) => report.examples),
    exports: sum((report) => report.exports),
    packed: reports.some((report) => report.packed),
  };
}

/** Checks every doc root under the repo root `io.cwd` belongs to; prints each finding, or the ok line. */
function checkAll(io: DocsIo): number {
  const root = findRoot(io.cwd) ?? io.cwd;
  const read = readWorkspace(root);
  if (!read.ok) {
    for (const error of read.errors) io.err(`${error}\n`);
    return EXIT_FAILED;
  }
  const { workspace } = read;
  const roots = docRootsOf(root, [{ dir: "", manifest: workspace.manifest }, ...workspace.packages]);
  const reports = roots.map((docRoot) => checkDocRoot(root, docRoot, io.tools));
  const findings = reports.flatMap((one) => one.findings);
  for (const finding of findings) io.err(`${finding}\n`);
  if (findings.length === 0) io.out(`${okLine(total(reports))}\n`);
  return findings.length === 0 ? 0 : EXIT_FAILED;
}

/** `--check` checks; with no flag sync runs first and its failure ends the run. Anything else is usage. */
export async function main(argv: string[], io: DocsIo = docsIo()): Promise<number> {
  if (argv.some((arg) => arg !== FLAG_CHECK)) {
    io.err(`${DOCS_USAGE}\n`);
    return EXIT_USAGE;
  }
  const synced = argv.includes(FLAG_CHECK) ? 0 : await io.sync(io.cwd);
  return synced === 0 ? checkAll(io) : synced;
}
