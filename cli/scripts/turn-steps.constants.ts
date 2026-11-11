/** The lockfiles `repo check` reads, by name, wherever they sit. */
export const LOCKFILES: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
]);
/** A package's manifest file. */
export const MANIFEST_FILE = "package.json";
/** Bun's config file, which `repo check` reads. */
export const BUNFIG_FILE = "bunfig.toml";
