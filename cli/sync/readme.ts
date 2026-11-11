import path from "node:path";

import { isPublic } from "../docs-exports.ts";
import { SECOND_GROUP } from "../docs-fences.constants.ts";
import { group, splitMarkdown } from "../docs-fences.ts";
import { listedFiles } from "../docs-index.ts";
import { INDEX_FILE, MARKDOWN_EXT, REFERENCES_DIR, under } from "../docs.constants.ts";
import { lines } from "../scripts/lines.ts";
import { hasOwnedHeader } from "./header.ts";
import type { Generator, Output } from "./outputs.ts";
import { CONTENTS_TITLE, MAX_HEADING, PACKAGE_FILE, handWritten, readmePath } from "./readme.constants.ts";
import type { PackageJson } from "./workspace.ts";

type DocRoot = { dir: string; manifest: PackageJson };
// `level` is 0 for a line that is no heading; a heading's `text` is its title.
type Row = { text: string; fenced: boolean; level: number };
type Parsed = { file: string; label: string; rows: Row[] };
type Doc = Parsed & { anchor: string; anchors: Map<string, string> };
type Site = { dir: string; docs: ReadonlyMap<string, Doc> };

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const LINK = /\]\(([^)\s]+)(\s+"[^"]*")?\)/g;
const OUTSIDE = /^(?:[a-z][a-z\d+.-]*:|\/|\?)/i;

/** Under the docs pack, the README.md of each public doc root, generated from its INDEX; a hand-written one is an error. */
export const readme: Generator = (ctx) => {
  if (!ctx.config.packs.includes("docs")) return { errors: [], outputs: [] };
  const roots = [{ dir: "", manifest: ctx.workspace.manifest }, ...ctx.workspace.packages].filter(
    ({ dir, manifest }) => isPublic(manifest) && ctx.read(under(dir, `${REFERENCES_DIR}/${INDEX_FILE}`)) !== null,
  );
  const outputs: Output[] = [];
  const errors: string[] = [];
  for (const root of roots) {
    const file = readmePath(root.dir);
    const existing = ctx.read(file);
    if (existing !== null && existing.trim() !== "" && !hasOwnedHeader(existing)) {
      errors.push(handWritten(file));
      continue;
    }
    const content = renderReadme(root, (rel) => ctx.read(rel), ctx.root);
    outputs.push({ content, kind: "file", managed: "whole", path: file, tracked: true });
  }
  return errors.length > 0 ? { errors, outputs: [] } : { errors, outputs };
};

/**
 * The README text of a doc root: name, description, contents and each listed file under its H1. Line 1 is left blank
 * for sync's header, so the header stands apart from the title.
 */
function renderReadme(root: DocRoot, read: (rel: string) => string | null, repoRoot: string): string {
  const { dir, manifest } = root;
  const indexPath = under(dir, `${REFERENCES_DIR}/${INDEX_FILE}`);
  const prefix = under(dir, `${REFERENCES_DIR}/`);
  const exists = (rel: string) => read(rel) !== null;
  const index = {
    name: manifest.name ?? "",
    path: indexPath,
    text: read(indexPath) /* the caller found it */ as string,
  };
  const listed = listedFiles(index, exists).filter((one) => one.path.startsWith(prefix));
  const parsed = listed.map(({ path: file }) => parseDoc(file, read(file) /* listed files exist */ as string));
  const title = manifest.name ?? path.posix.basename(dir === "" ? repoRoot.replaceAll("\\", "/") : dir);
  const used = new Set<string>();
  uniqueSlug(used, title);
  uniqueSlug(used, CONTENTS_TITLE);
  const docs = parsed.map((one) => anchorDoc(one, used));
  const site: Site = { dir, docs: new Map(docs.map((doc) => [doc.file, doc])) };
  const description = descriptionOf(read(under(dir, PACKAGE_FILE)));
  const contents = docs.map((doc) => `- [${doc.label}](#${doc.anchor})`).join("\n");
  const head = [`# ${title}`, ...(description === "" ? [] : [description])];
  const blocks = [...head, `## ${CONTENTS_TITLE}\n\n${contents}`, ...docs.map((doc) => renderDoc(doc, site))];
  return `\n${blocks.join("\n\n")}\n`;
}

/** The `description` of a package.json text, or "" when it has none or the text is not an object. */
function descriptionOf(text: string | null): string {
  if (text === null) return "";
  try {
    const value: unknown = JSON.parse(text);
    const object = (typeof value === "object" && value !== null ? value : {}) /* read from JSON */ as {
      description?: unknown;
    };
    return typeof object.description === "string" ? object.description : "";
  } catch {
    return "";
  }
}

/** A GitHub-style anchor: lowercase, punctuation but `-` and `_` dropped, each space a `-`. */
function slugOf(title: string): string {
  return title
    .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\p{M}_\s-]/gu, "")
    .replaceAll(/\s/g, "-");
}

/** The anchor for `title` not yet in `used`: the slug, then `-1`, `-2`; it joins `used`. */
function uniqueSlug(used: Set<string>, title: string): string {
  const base = slugOf(title);
  let anchor = base;
  for (let n = 1; used.has(anchor); n++) anchor = `${base}-${n}`;
  used.add(anchor);
  return anchor;
}

/** The numbers of the lines inside a fenced block, its fences included. */
function fencedLines(text: string): Set<number> {
  const fenced = new Set<number>();
  for (const { start, body } of splitMarkdown(text).fences)
    for (let line = start; line <= start + body.length + 1; line++) fenced.add(line);

  return fenced;
}

const isBlank = (row: Row) => row.level === 0 && row.text.trim() === "";

function rowOf(raw: string, fenced: boolean): Row {
  const heading = fenced ? null : HEADING.exec(raw);
  if (heading === null) return { fenced, level: 0, text: raw };
  return { fenced, level: group(heading, 1).length, text: group(heading, SECOND_GROUP) };
}

/** A reference file split into its label (first H1, else the file name) and rows without that H1. */
function parseDoc(file: string, text: string): Parsed {
  const fenced = fencedLines(text);
  const all = lines(text).map((raw, at) => rowOf(raw, fenced.has(at + 1)));
  const h1 = all.find((row) => row.level === 1);
  const rows = all.filter((row) => row !== h1);
  const first = rows.findIndex((row) => !isBlank(row));
  const last = rows.map(isBlank).lastIndexOf(false);
  return { file, label: h1?.text ?? path.posix.basename(file, MARKDOWN_EXT), rows: rows.slice(first, last + 1) };
}

/** The doc with its README anchor, and the README anchor of each of its headings by the slug the file itself gives. */
function anchorDoc(doc: Parsed, used: Set<string>): Doc {
  const local = new Set<string>();
  const anchors = new Map<string, string>();
  const add = (title: string) => {
    const own = uniqueSlug(local, title);
    const global = uniqueSlug(used, title);
    anchors.set(own, global);
    return global;
  };
  const anchor = add(doc.label);
  for (const row of doc.rows) if (row.level > 0) add(row.text);
  return { ...doc, anchor, anchors };
}

/** `## label` and the body: headings one level down, links to glued files turned into anchors. */
function renderDoc(doc: Doc, site: Site): string {
  const body = doc.rows.map((row) => {
    if (row.level > 0) return `${"#".repeat(Math.min(row.level + 1, MAX_HEADING))} ${row.text}`;
    return row.fenced ? row.text : rewriteLinks(row.text, doc, site);
  });
  return [`## ${doc.label}`, ...(body.length === 0 ? [] : ["", ...body])].join("\n");
}

function rewriteLinks(text: string, from: Doc, site: Site): string {
  return text.replaceAll(LINK, (_whole, target: string, title: string | undefined) => {
    return `](${linkTarget(target, from, site)}${title ?? ""})`;
  });
}

/** Where a link written in `from` points in the README: an anchor for a glued file, else a path from the README's folder. */
function linkTarget(raw: string, from: Doc, site: Site): string {
  if (OUTSIDE.test(raw)) return raw;
  const hash = raw.indexOf("#");
  const target = hash < 0 ? raw : raw.slice(0, hash);
  const fragment = hash < 0 ? "" : raw.slice(hash);
  if (target === "") {
    const mapped = from.anchors.get(fragment.slice(1));
    return mapped === undefined ? raw : `#${mapped}`;
  }
  const resolved = path.posix.join(path.posix.dirname(from.file), target);
  const glued = site.docs.get(resolved);
  if (glued !== undefined) return `#${glued.anchors.get(fragment.slice(1)) ?? glued.anchor}`;
  return `${path.posix.relative(site.dir || ".", resolved) || "."}${fragment}`;
}
