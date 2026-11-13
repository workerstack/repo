/** Where `repo sync` keeps the generated sections that `repo doctor` reads back. */
export const INDEX_REL: string = "references/INDEX.md";

/** The most characters a reference's frontmatter `description:` may have. */
export const DESC_MAX: number = 32;

export const REFS_REL: string = "references";

/** Reference files the refs list leaves out. */
export const SKIP_REF_NAMES: ReadonlySet<string> = /* @__PURE__ */ new Set(["INDEX.md"]);
