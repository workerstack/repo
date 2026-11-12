import path from "node:path";

import { SCOPED_SEGMENTS } from "./docs-fences.constants.ts";
import { firstGroup, group, splitMarkdown } from "./docs-fences.ts";
import {
  INDEX_FILE,
  INSTALLED_DIR,
  LINK_TAIL,
  MARKDOWN_EXT,
  REFERENCES_DIR,
  WHITESPACE,
  brokenLink,
  missingPackage,
  noIndex,
  unlisted,
} from "./docs.constants.ts";

/** A file an INDEX lists: its root-relative POSIX path and the INDEX line that names it. */
export type Listed = { path: string; line: number };

/** An INDEX to read: its text, its own root-relative POSIX path and the name of the package it belongs to. */
export type IndexFile = { text: string; path: string; name: string };

/** Whether a root-relative POSIX path exists, as a file or a folder. */
export type Exists = (rel: string) => boolean;

const LINK = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

// A markdown link target, a code span, or a path alone in a table cell.
const ENTRY = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)|`([^`]+)`|\|\s*([^|\s`[\]()]+\.md)\s*(?=\||$)/g;
const OUTSIDE = /^(?:[a-z][a-z\d+.-]*:|\/|#|\?)/i;

/** The target of a link without its `#fragment` or `?query`; null for an external or same-page one. */
function relativeTarget(raw: string): string | null {
  if (OUTSIDE.test(raw)) return null;

  return raw.replace(LINK_TAIL, "");
}

/** Root-relative path of `target` as written in `file`. */
function resolveFrom(file: string, target: string): string {
  return path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
}

/** The package folder an INDEX at `indexPath` belongs to: what comes before its `references/` folder. */
function packageDirOf(indexPath: string): string {
  const parts = indexPath.split("/");

  return parts.slice(0, Math.max(0, parts.indexOf(REFERENCES_DIR))).join("/");
}

/**
 * The files an INDEX lists, in INDEX order, each with its line, as root-relative POSIX paths. `index.path` is the
 * INDEX's own root-relative path, `index.name` the package name: a path through `node_modules/{name}/` names the
 * package's own file, so it resolves from the folder that holds `references/`. An entry is a markdown link target, or
 * a path ending `.md` in a table cell or code span; one that does not exist (`exists`), the INDEX itself and a
 * second mention of a file are left out, and so is every fenced line.
 */
export function listedFiles(index: IndexFile, exists: Exists): Listed[] {
  const { text: indexText, path: indexPath } = index;
  const own = `${INSTALLED_DIR}${index.name}/`;
  const found: Listed[] = [];

  for (const { line, text } of splitMarkdown(indexText).prose) {
    for (const entry of text.matchAll(ENTRY)) {
      const target = relativeTarget(firstGroup(entry));

      if (target === null || !target.endsWith(MARKDOWN_EXT) || WHITESPACE.test(target)) continue;
      const at = target.indexOf(own);

      const resolved =
        at < 0
          ? resolveFrom(indexPath, target)
          : path.posix.join(packageDirOf(indexPath), target.slice(at + own.length));

      if (resolved === indexPath || found.some((one) => one.path === resolved) || !exists(resolved)) continue;
      found.push({ line, path: resolved });
    }
  }

  return found;
}

/**
 * One finding per reference file its own folder's INDEX does not list; a folder's INDEX is listed by its parent's.
 * `top` is the INDEX nothing lists, `listedBy` maps each INDEX to the paths it lists.
 */
export function unlistedFindings(
  files: readonly string[],
  top: string,
  listedBy: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  const findings: string[] = [];

  for (const file of files) {
    if (file === top) continue;
    const folder = path.posix.dirname(file);

    const index = path.posix.join(
      path.posix.basename(file) === INDEX_FILE ? path.posix.dirname(folder) : folder,
      INDEX_FILE,
    );

    const listed = listedBy.get(index);

    if (listed === undefined) findings.push(noIndex(file, index));
    else if (!listed.has(file)) findings.push(unlisted(file, index));
  }

  return findings;
}

/** The package name in a root-relative path through `node_modules/`, and the folder it is installed in. */
function installedPackage(resolved: string) {
  const at = resolved.lastIndexOf(INSTALLED_DIR) + INSTALLED_DIR.length;
  const rest = resolved.slice(at);

  const name = rest
    .split("/")
    .slice(0, rest.startsWith("@") ? SCOPED_SEGMENTS : 1)
    .join("/");

  return { dir: `${resolved.slice(0, at)}${name}`, name };
}

/** One finding per relative link in `text` (the contents of `file`) whose target does not exist. */
export function linkFindings(file: string, text: string, exists: Exists): string[] {
  const findings: string[] = [];

  for (const { line, text: prose } of splitMarkdown(text).prose) {
    for (const link of prose.matchAll(LINK)) {
      const target = relativeTarget(group(link, 1));

      if (target === null) continue;
      const resolved = resolveFrom(file, target);

      if (exists(resolved)) continue;
      const installed = resolved.includes(INSTALLED_DIR) ? installedPackage(resolved) : null;
      findings.push(
        installed !== null && !exists(installed.dir)
          ? missingPackage(`${file}:${line}`, target, installed.name)
          : brokenLink(`${file}:${line}`, target),
      );
    }
  }

  return findings;
}
