/** The knobs `.repo/map.jsonc` may set. */
export interface MapConfig {
  budget: number;
  depthCap: number;
  foldAt: number;
  codeExt: string[];
  skip: string[];
  include: string[];
  exclude: string[];
}

/** Config plus the hook's own character cap. */
export interface MapOptions extends Partial<MapConfig> {
  maxChars?: number;
}

/** A folder in the raw tree. `own` = holds a kept file directly; `pkg` is the package name ("" when unnamed) on package roots, else null. */
export interface TreeNode {
  name: string;
  path: string;
  kids: Map<string, TreeNode>;
  own: boolean;
  pkg: string | null;
}

/**
 * One row of the display tree: a fold standing for many plain leaf dirs, named in `label`, or one dir (or a chain of
 * pass-through dirs joined in `label`).
 */
export type Row =
  | { kind: "fold"; label: string[]; path: string; pkg: null; kids: Row[] }
  | { kind: "dir"; label: string; path: string; pkg: string | null; kids: Row[] };

/** A rendered map: its text, row count, token estimate and the depth it fit at. */
export interface FolderMapResult {
  text: string;
  rows: number;
  tokens: number;
  depth: number;
}

/** Which files a tree keeps: code by extension, never under a skipped segment, unless a dir is forced in or out. */
export interface TreeFilter {
  code: RegExp;
  skip: Set<string>;
  include: RegExp[];
  exclude: RegExp[];
}

/** Where a tree reads package names: the root and the manifest each package dir holds. */
export interface TreePlace {
  root: string;
  manifests: Map<string, string>;
}

/** How a render fits: the deepest cap to try, the character limit and the scope its package paths start from. */
export interface RenderFit {
  cap: number;
  limit: number;
  base: string;
}

/** What `rowText` adds: the ellipsis of a row past the cap, and the scope its package path starts from. */
export interface RowTextOptions {
  more?: boolean;
  base?: string;
}
