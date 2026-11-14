/** The `(parallel: a, b)` marker that ends a plan phase or a roadmap slice, and how its list splits. */
export const PARALLEL_RE: RegExp = /\s*\(parallel:(?<files>[^)]*)\)\s*$/;
export const FILE_SPLIT_RE: RegExp = /[,\s]+/;

/** A path segment holding a glob character. */
export const GLOB_SEGMENT_RE: RegExp = /[*?]/;

/** The segment a folder entry ends with: any depth under it. */
export const ANY_DEPTH = "**";
