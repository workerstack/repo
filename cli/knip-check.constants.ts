/** knip's exit code for a config it cannot run with. */
export const EXIT_BAD_CONFIG = 2;

/** How many of knip's last stderr lines a failure problem quotes. */
export const STDERR_LINES = 3;

/** How a problem line names one issue type: what is wrong, and what fixes it. */
export type Wording = { type: string; label: string; fix: string };

/** The issue type of a file nothing imports, which names no export. */
export const FILES_TYPE = "files";

/** The issue type of a command no manifest provides. */
export const BINARIES_TYPE = "binaries";
const DELETE_OR_UNEXPORT = "delete it or stop exporting it";
const REMOVE = "remove it";
const ADD_TO_MANIFEST = "add it to package.json";

/** Every issue type knip 6.43.0 reports, in the order a file's issues are printed. */
export const WORDINGS: readonly Wording[] = [
  { fix: "delete it", label: "unused file", type: FILES_TYPE },
  { fix: REMOVE, label: "unused dependency", type: "dependencies" },
  { fix: REMOVE, label: "unused devDependency", type: "devDependencies" },
  { fix: REMOVE, label: "unused optional peer dependency", type: "optionalPeerDependencies" },
  { fix: ADD_TO_MANIFEST, label: "unlisted dependency", type: "unlisted" },
  { fix: "add the package that provides it to package.json", label: "unlisted binary", type: BINARIES_TYPE },
  { fix: "fix the path or install the package", label: "unresolved import", type: "unresolved" },
  { fix: DELETE_OR_UNEXPORT, label: "unused export", type: "exports" },
  { fix: DELETE_OR_UNEXPORT, label: "unused namespace export", type: "nsExports" },
  { fix: DELETE_OR_UNEXPORT, label: "unused type", type: "types" },
  { fix: DELETE_OR_UNEXPORT, label: "unused namespace type", type: "nsTypes" },
  { fix: "delete it", label: "unused enum member", type: "enumMembers" },
  { fix: "delete it", label: "unused namespace member", type: "namespaceMembers" },
  { fix: "export it under one name", label: "duplicate export", type: "duplicates" },
  { fix: REMOVE, label: "unused catalog entry", type: "catalog" },
  { fix: "add it to the catalog", label: "unresolved catalog reference", type: "catalogReferences" },
  { fix: "break the cycle", label: "circular import", type: "cycles" },
];

/** The issue types a `dependency` ignore covers. */
export const DEPENDENCY_TYPES: readonly string[] = [
  "dependencies",
  "devDependencies",
  "optionalPeerDependencies",
  "unlisted",
];

/** The manifest fields a dependency can be declared in. */
export const MANIFEST_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
