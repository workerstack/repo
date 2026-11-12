/** The virtual dir under a package that the in-memory declarations sit in, so bare imports resolve from the package. */
export const VIRTUAL_DIR = ".repo-surface";

/** The build config whose outputs map an emitted `.d.ts` target back to its source. */
export const BUILD_CONFIG = "tsconfig.build.json";

/** The package's own manifest, which a json export may point at but which is no tsconfig. */
export const MANIFEST = "package.json";

/** The dir installed packages sit in, which a `*` export never reaches into. */
export const INSTALLED_DIR = "node_modules";

/** The path segment of a file inside an installed package. */
export const INSTALLED_SEGMENT: string = `/${INSTALLED_DIR}/`;

/** The fields one of which a json export must have to be read as a tsconfig. */
export const TSCONFIG_FIELDS: readonly string[] = ["compilerOptions", "extends", "files", "include"];

/** The package dir of an installed file: the name after its last `node_modules`, scoped or not. */
export const PACKAGE_DIR: RegExp = /.*\/node_modules\/((?:@[^/]+\/)?[^/]+)\//;

/** The package a bare specifier names; a relative, absolute or `node:` specifier names none. */
export const BARE_SPECIFIER: RegExp = /^(?![./])((?:@[^/:]+\/)?[^/:]+)(?:\/|$)/;

/** A declaration file name. */
export const DECLARATION: RegExp = /\.d\.[cm]?ts$/;

/** A TypeScript source or declaration file name. */
export const TYPESCRIPT: RegExp = /\.(?:[cm]?ts|tsx)$/;

/** A script file name, with the `m` or `c` of its extension captured. */
export const SCRIPT: RegExp = /\.([cm]?)jsx?$/;

/** The declaration beside a script: `.js` to `.d.ts`, keeping an `m` or `c`. */
export const SIBLING_DECLARATION = ".d.$1ts";

/** The text before a `*` stands in for a file name, so a dirname of it is the pattern's static dir. */
export const NAME_STAND_IN = "_";

/** Where a package's installed manifest sits below a `node_modules` dir. */
export function installedManifest(name: string): string {
  return `${INSTALLED_DIR}/${name}/${MANIFEST}`;
}
