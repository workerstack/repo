import fs from "node:fs";
import path from "node:path";

import enhanced from "enhanced-resolve";

/**
 * An `@import` or `@reference` still to read: what the resolver asks, what a message shows, and where it sits.
 */
type Link = { dir: string; from: string; request: string; shown: string };

/** An import that does not resolve: the specifier as written and the sheet (or config key) that wrote it. */
type BrokenImport = { from: string; specifier: string };

/** The resolver `resolverOf` makes. */
type Resolver = ReturnType<typeof enhanced.ResolverFactory.createResolver>;

/** A sheet read from disk: its resolved path and its text with the comments removed. */
type Sheet = { file: string; text: string };

/** Each custom property the sheets of an entry's `@import` graph declare, and the first import that did not resolve. */
export type SheetVars = { broken: BrokenImport | null; names: ReadonlySet<string> };

/** How long, in milliseconds, the resolver's file system cache keeps a read. */
const CACHE_MS = 4000;

const COMMENT = /\/\*[\s\S]*?\*\//g;
const DECLARATION = /(--[\w-]+)\s*:/g;
const PROPERTY = /@property\s+(--[\w-]+)/g;
const IMPORT = /@(?:import|reference)\s+(?:url\(\s*)?["']?([^"')\s;]+)/g;
const REMOTE = /^(?:[a-z]+:)?\/\//i;

/** The key `lint.tailwind.entryPoint`, as a message names the entry's place when the entry itself is missing. */
const ENTRY_KEY = "lint.tailwind.entryPoint";

/** Tailwind's own sheet resolver, sync: `@import "tailwindcss"` lands where a build lands. */
function resolverOf(): Resolver {
  return enhanced.ResolverFactory.createResolver({
    conditionNames: ["style"],
    extensions: [".css"],
    fileSystem: new enhanced.CachedInputFileSystem(fs, CACHE_MS),
    mainFields: ["style"],
    useSyncFileSystemCalls: true,
  });
}

/** `file` shown relative to `cwd` with forward slashes. */
function shownPath(cwd: string, file: string): string {
  return path.relative(cwd, file).replaceAll("\\", "/");
}

/** One match of a pattern with a capture group: the group, and where the whole match starts and ends in the text. */
export type Found = { end: number; name: string; start: number };

/** Calls `found` for each match of `pattern`, which has one capture group, in `text`. */
export function eachMatch(text: string, pattern: RegExp, found: (hit: Found) => void): void {
  for (const match of text.matchAll(pattern)) {
    const name = match[1] /* every pattern given has its one capture group, so it took part in the match */ as string;

    found({ end: match.index + match[0].length, name, start: match.index });
  }
}

/** The resolved path and comment-free text of the sheet `link` names, or null when it does not resolve. */
function loadSheet(resolver: Resolver, link: Link): Sheet | null {
  try {
    // A resolver that answers `false` for an ignored module has no file to read: the read throws, so it is broken.
    const file = String(resolver.resolveSync({}, link.dir, link.request));

    return { file, text: fs.readFileSync(file, "utf8").replaceAll(COMMENT, "") };
  } catch {
    return null;
  }
}

/** The links `sheet` imports, which `cwd` makes relative in messages; remote urls are left out. */
function linksOf(sheet: Sheet, cwd: string): Link[] {
  const links: Link[] = [];

  eachMatch(sheet.text, IMPORT, ({ name: specifier }) => {
    if (REMOTE.test(specifier)) return;
    const from = shownPath(cwd, sheet.file);

    links.push({ dir: path.dirname(sheet.file), from, request: specifier, shown: specifier });
  });

  return links;
}

/**
 * The custom properties declared by the sheet at `entry` (relative to `cwd`) and every sheet it reaches through
 * `@import` or `@reference`, however deep; the first import that does not resolve is reported with them.
 */
export function sheetVars(entry: string, cwd: string): SheetVars {
  const resolver = resolverOf();
  const names = new Set<string>();
  const read = new Set<string>();
  const queue: Link[] = [{ dir: cwd, from: ENTRY_KEY, request: path.resolve(cwd, entry), shown: entry }];
  let broken: BrokenImport | null = null;

  for (const link of queue) {
    const sheet = loadSheet(resolver, link);

    if (sheet === null) {
      broken ??= { from: link.from, specifier: link.shown };
    } else if (!read.has(sheet.file)) {
      read.add(sheet.file);

      for (const pattern of [DECLARATION, PROPERTY]) eachMatch(sheet.text, pattern, (hit) => names.add(hit.name));
      queue.push(...linksOf(sheet, cwd));
    }
  }

  return { broken, names };
}
