/** Where `repo sync` keeps the generated sections that `repo doctor` reads back. */
export const INDEX_REL: string = "references/INDEX.md";
/** The longest a table cell gets before it is cut with an ellipsis. */
export const DESC_MAX: number = 120;
/** How the stock package's reference files are named in the refs table. */
export const STOCK_REFS_PREFIX: string = "node_modules/@workerstack/repo/references/";
export const REFS_REL: string = "references";
/** A reference file bigger than this gets a row of its name only. */
export const HUGE_BYTES: number = 512 * 1024;
/** Reference files the refs table leaves out. */
export const SKIP_REF_NAMES: ReadonlySet<string> = /* @__PURE__ */ new Set(["INDEX.md"]);
/** A quoted scalar has at least its two quotes. */
export const QUOTED_MIN: number = 2;
