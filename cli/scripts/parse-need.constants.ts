/** The jobs a `need:` row may name. */
export const NEED_JOBS: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "search",
  "exec",
  "web",
  "test",
  "slice",
  "fetch",
]);
/** The job that reads a stash, so it may name one in place of a query. */
export const SLICE_JOB = "slice";
/** A line `need: [ ... ]`; group 1 is the array's JSON. */
export const NEED_LINE: RegExp = /^\s*need:\s*(\[[\s\S]*\])\s*$/m;
