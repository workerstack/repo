/** The string methods that match their first argument against the receiver. */
export const MATCHING_METHODS: readonly string[] = [
  "endsWith",
  "startsWith",
  "includes",
  "split",
  "indexOf",
  "lastIndexOf",
];

/** A forward or back slash in a cooked literal value. */
export const SEPARATOR: RegExp = /[/\\]/;

/** The name node gives a native working directory, as an identifier or a member. */
export const CWD = "cwd";

/** Node's own names for the directory of a module. */
export const MODULE_DIRS: readonly string[] = ["__dirname", "__filename"];

/** The reads of `import.meta` that are native paths. */
export const META_PATHS: readonly string[] = ["dirname", "filename"];

/** The `path` namespace of the Windows spelling, a native path on every platform. */
export const WIN32 = "win32";

/** `process.cwd()`: the object and the method. */
export const PROCESS = "process";

/** The kinds of import specifier that bind a module object, not a name inside it. */
export const MODULE_SPECIFIERS: readonly string[] = ["ImportDefaultSpecifier", "ImportNamespaceSpecifier"];
const PATH_CALLS: readonly string[] = ["join", "resolve", "dirname", "normalize", "relative"];
const FS_CALLS: readonly string[] = ["realpath", "realpathSync", "mkdtemp", "mkdtempSync"];

/** The modules that export a function returning a native path. */
type NativeModule =
  | "fs"
  | "fs/promises"
  | "node:fs"
  | "node:fs/promises"
  | "node:os"
  | "node:path"
  | "node:url"
  | "os"
  | "path"
  | "url";

/** The functions that return a native path, by the module they are imported from. */
export const NATIVE_CALLS: Readonly<Record<NativeModule, readonly string[]>> = {
  fs: FS_CALLS,
  "fs/promises": FS_CALLS,
  "node:fs": FS_CALLS,
  "node:fs/promises": FS_CALLS,
  "node:os": ["tmpdir", "homedir"],
  "node:path": PATH_CALLS,
  "node:url": ["fileURLToPath"],
  os: ["tmpdir", "homedir"],
  path: PATH_CALLS,
  url: ["fileURLToPath"],
};
