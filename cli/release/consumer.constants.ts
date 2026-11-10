/** The conditions whose target runs, in the order a package author lists them. */
export const RUNTIME_CONDITIONS: readonly string[] = ["import", "require", "default"];
export const TYPES_CONDITION: string = "types";
export const STAR: string = "*";
export const ROOT_KEY: string = ".";
export const CURRENT_DIR: string = "./";
export const JSON_FILE: RegExp = /\.json$/;
export const CODE_FILE: RegExp = /\.(?:[cm]?[jt]sx?)$/;
export const TS_SOURCE: RegExp = /\.(?:[cm]?ts|tsx)$/;
export const REGEX_SPECIALS: RegExp = /[.+?^${}()|[\]\\]/g;

export const PROJECT_DIR_PREFIX: string = "repo-consumer-";
export const PROJECT_MANIFEST: string = '{"name":"consumer-test","private":true}\n';
export const PROJECT_FILE: string = "package.json";
export const BUN_ADD = (...specs: string[]): string[] => ["add", ...specs];
export const INSTALLED_DIR: string = "node_modules";
export const PROBE_FILE: string = "probe.mjs";
export const PROBE_INPUT: string = "probe-input.json";
export const PROBE_OUTPUT: string = "probe-output.json";
export const TYPES_FILE: string = "consumer.ts";
export const TSCONFIG_FILE: string = "tsconfig.json";
export const TSC_MODULE: string = "typescript/lib/tsc.js";
export const TSC_ARGS = (tsc: string): string[] => [tsc, "-p", TSCONFIG_FILE];
export const PROBE_ARGS: string[] = [PROBE_FILE];
export const TSCONFIG: string = `{
  "compilerOptions": {
    "target": "ES2022",
    "strict": true,
    "module": "preserve",
    "moduleResolution": "bundler",
    "noEmit": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true
  },
  "files": ["${TYPES_FILE}"]
}
`;
/** Runs in a `bun` child of the temp project: imports or resolves each subpath and writes the failures to a file. */
export const PROBE_SOURCE: string = `import { readFileSync, writeFileSync } from "node:fs";
const items = JSON.parse(readFileSync("${PROBE_INPUT}", "utf8"));
const failures = [];
for (const { key, spec, kind } of items) {
  try {
    if (kind === "other") import.meta.resolve(spec);
    else await import(spec);
  } catch (error) {
    failures.push({ key, kind, message: String(error?.message ?? error).split("\\n")[0] });
  }
}
writeFileSync("${PROBE_OUTPUT}", JSON.stringify(failures));
`;
export const TYPE_IMPORT = (index: number, spec: string): string =>
  `import type * as m${index} from ${JSON.stringify(spec)};\n`;
export const EMPTY_MODULE: string = "export {};\n";
export const LINT_OK: string = " · publint ok · attw ok";
/** The name `repo release api` installs the old version under, beside the new one. */
export const OLD_ALIAS: string = "old";
export const NPM_ALIAS = (name: string, version: string): string => `${OLD_ALIAS}@npm:${name}@${version}`;
export const TARBALL_ALIAS = (tarball: string): string => `${OLD_ALIAS}@${tarball}`;
export const BUN_ADD_FROM = (registry: string, spec: string): string[] => ["add", "--registry", registry, spec];
