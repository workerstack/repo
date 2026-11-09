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
  { type: FILES_TYPE, label: "unused file", fix: "delete it" },
  { type: "dependencies", label: "unused dependency", fix: REMOVE },
  { type: "devDependencies", label: "unused devDependency", fix: REMOVE },
  { type: "optionalPeerDependencies", label: "unused optional peer dependency", fix: REMOVE },
  { type: "unlisted", label: "unlisted dependency", fix: ADD_TO_MANIFEST },
  { type: BINARIES_TYPE, label: "unlisted binary", fix: "add the package that provides it to package.json" },
  { type: "unresolved", label: "unresolved import", fix: "fix the path or install the package" },
  { type: "exports", label: "unused export", fix: DELETE_OR_UNEXPORT },
  { type: "nsExports", label: "unused namespace export", fix: DELETE_OR_UNEXPORT },
  { type: "types", label: "unused type", fix: DELETE_OR_UNEXPORT },
  { type: "nsTypes", label: "unused namespace type", fix: DELETE_OR_UNEXPORT },
  { type: "enumMembers", label: "unused enum member", fix: "delete it" },
  { type: "namespaceMembers", label: "unused namespace member", fix: "delete it" },
  { type: "duplicates", label: "duplicate export", fix: "export it under one name" },
  { type: "catalog", label: "unused catalog entry", fix: REMOVE },
  { type: "catalogReferences", label: "unresolved catalog reference", fix: "add it to the catalog" },
  { type: "cycles", label: "circular import", fix: "break the cycle" },
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
