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

/** A TypeScript source or declaration file name; group 1 is the `c` or `m` of a module kind's extension. */
export const TYPESCRIPT: RegExp = /\.(?:([cm])?ts|tsx)$/;

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

/** `jsx: preserve` as a number in parsed compiler options; TS 7 ships its JsxEmit enum as a type only. */
export const JSX_PRESERVE = 1;

/** The scope DefinitelyTyped publishes a package's types under, `@types/a` for `a` and `@types/s__p` for `@s/p`. */
export const TYPES_SCOPE = "@types/";

/** The config tsc emits the own declarations under, written in the surface's temp dir. */
export const EMIT_CONFIG = "emit.json";

/** The config the scan project extends, written beside the emit config. */
export const SCAN_CONFIG = "scan.json";

/** The prefix of the temp dir, under the package's `.repo/tmp`, that tsc emits the declarations into. */
export const SURFACE_TEMP = "surface-";

/** A line `tsc --listEmittedFiles` prints for each file it writes. */
export const EMITTED_LINE: RegExp = /^TSFILE: (.+)$/;

/** Why a surface cannot be read: tsc emitted no declaration for an exported source, with tsc's first line. */
export function noDeclaration(source: string, first: string): string {
  return `tsc emitted no declaration for ${source}: ${first}`;
}
