import { readDoc } from "./read-doc.ts";
import { MD_SUFFIX, RULES } from "./sources.constants.ts";
import type { Doc, DocFile, Kind } from "./sources.types.ts";

/** The docs of each root to merge, stock first; problems are appended to `problems`. */
export type MergeInput = {
  kind: Kind;
  perRoot: readonly DocFile[][];
  problems: string[];
};

type Parsed = { doc: Doc | null; file: DocFile };
/** The merged list being built: a held slot is null until its replacement lands; `at` maps a name to its slot. */
type Slots = { merged: (Doc | null)[]; at: Map<string, number> };

function nameOf(file: string): string {
  return file.replace(MD_SUFFIX, "").toLowerCase();
}

/** A doc's `overrides`, case-folded, when it is a string. */
function overridesOf(doc: Doc | null): string | undefined {
  const overrides = doc?.data["overrides"];
  return typeof overrides === "string" ? overrides.toLowerCase() : undefined;
}

/** The stock names later files replace; a bad `overrides` or a taken name without one is a problem. */
function claimed(input: MergeInput, parsed: readonly Parsed[], stockNames: ReadonlySet<string>): Set<string> {
  const singular = input.kind === RULES ? "rule" : "subagent";
  const replaced = new Set<string>();
  for (const { file, doc } of parsed) {
    const overrides = doc?.data["overrides"];
    if (typeof overrides === "string" && stockNames.has(overrides.toLowerCase())) {
      replaced.add(overrides.toLowerCase());
    } else if (typeof overrides === "string") {
      input.problems.push(`${file.rel}: overrides "${overrides}" but no stock ${singular} has that name`);
    } else if (doc !== null && stockNames.has(nameOf(file.file))) {
      const name = file.file.replace(MD_SUFFIX, "");
      input.problems.push(`${file.rel}: a stock ${singular} has this name; add \`overrides: ${name}\` or rename it`);
    }
  }
  return replaced;
}

/** Puts `doc` in the slot of `key`, or a new slot at the end. */
function place(slots: Slots, doc: Doc, key: string): void {
  const index = slots.at.get(key);
  if (index === undefined) slots.at.set(key, slots.merged.push(doc) - 1);
  else slots.merged[index] = doc;
}

/**
 * Stock files first, then each later root's: a file with `overrides: <name>` replaces the earlier file of that name
 * in place; a file whose own name is taken, or whose `overrides` names nothing, is a problem. Only the files that
 * survive are parsed.
 */
export function mergeDocs(input: MergeInput): Doc[] {
  const [stockFiles, ...later] = input.perRoot /* loadSources always passes the stock root first */ as [
    DocFile[],
    ...DocFile[][],
  ];
  const stockNames = new Set(stockFiles.map((file) => nameOf(file.file)));
  const parsed = later.flat().map((file) => ({ doc: readDoc(input.kind, file, input.problems), file }));
  const replaced = claimed(input, parsed, stockNames);
  const slots: Slots = { at: new Map(), merged: [] };
  for (const file of stockFiles) {
    const key = nameOf(file.file);
    // A replaced stock file is never read; its slot is held for the replacement.
    if (replaced.has(key)) {
      slots.at.set(key, slots.merged.push(null) - 1);
    } else {
      const doc = readDoc(input.kind, file, input.problems);
      if (doc !== null) place(slots, doc, key);
    }
  }
  for (const { file, doc } of parsed) {
    const overrides = overridesOf(doc);
    if (doc !== null)
      place(slots, doc, overrides !== undefined && replaced.has(overrides) ? overrides : nameOf(file.file));
  }
  return slots.merged.filter((doc): doc is Doc => doc !== null);
}
