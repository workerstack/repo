import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { ADD, ADD_DEV, TYPESCRIPT_NAME, typescriptLine } from "./check-typescript.constants.ts";
import { tryJson } from "./json.ts";
import { installedDir, readVersion, requireManifest } from "./link-installed.ts";
import { NATIVE_TYPESCRIPT_MAJOR } from "./sync/vscode-defaults.constants.ts";

const DECIMAL = 10;

/** True when `cwd`'s package.json lists typescript under `dependencies`. */
function isDependency(cwd: string): boolean {
  const file = path.join(cwd, "package.json");
  const schema = z.object({ dependencies: z.record(z.string(), z.string()).optional() });
  const root = fs.existsSync(file) ? tryJson(schema, fs.readFileSync(file, "utf8")) : undefined;

  return root?.dependencies?.[TYPESCRIPT_NAME] !== undefined;
}

/**
 * One line when `cwd` installs a typescript whose major is below 7, naming the add that moves it to the version
 * `pkgRoot` ships with. A missing install, or a version with no leading number, gives none: no add fixes it.
 */
export function checkTypescript(cwd: string, pkgRoot: string): string[] {
  const installed = readVersion(installedDir(cwd, TYPESCRIPT_NAME));
  const major = Number.parseInt(installed ?? "", DECIMAL);

  if (installed === null || Number.isNaN(major) || major >= NATIVE_TYPESCRIPT_MAJOR) return [];
  const wanted = requireManifest(pkgRoot).dependencies?.[TYPESCRIPT_NAME] ?? String(NATIVE_TYPESCRIPT_MAJOR);

  return [typescriptLine(installed, `${isDependency(cwd) ? ADD : ADD_DEV} ${TYPESCRIPT_NAME}@${wanted}`)];
}
