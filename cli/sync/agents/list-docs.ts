import fs from "node:fs";
import path from "node:path";

import { AFTER, BEFORE, MD } from "./sources.constants.ts";
import type { Doc, DocFile } from "./sources.types.ts";

/** Where to list docs: `<root>/<dir>/<kind>`, and the origin and scope every listed file carries. */
export type DocsAt = {
  root: string;
  dir: string;
  kind: string;
  origin: Doc["origin"];
  scope: string;
};

/** `<root>/<dir>/<kind>/**\/*.md` in plain string order of the POSIX path; dot entries skipped, symlinks followed. */
export function listDocs({ root, dir, kind, origin, scope }: DocsAt): DocFile[] {
  const base = path.join(root, dir, kind);
  const found: DocFile[] = [];
  function walk(abs: string, file: string): void {
    for (const name of fs.readdirSync(abs)) {
      if (name.startsWith(".")) continue;
      const child = path.join(abs, name);
      const childFile = file === "" ? name : `${file}/${name}`;
      if (fs.statSync(child).isDirectory()) walk(child, childFile);
      else if (name.endsWith(MD))
        found.push({ abs: child, file: childFile, origin, rel: `${dir}/${kind}/${childFile}`, scope });
    }
  }
  if (fs.existsSync(base)) walk(base, "");
  // Paths in one root are unique, so the comparator never sees a tie.
  return found.toSorted((a, b) => (a.file < b.file ? BEFORE : AFTER));
}
