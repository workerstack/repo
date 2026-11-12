/**
 * What `bun repo env migrate` reads before it rewrites: every tracked source that mentions createScriptEnv or a
 * helper (the AST then decides what it calls), the ones it skips and why (it defines createScriptEnv, is a test, or
 * is a fixture), the packages that define createScriptEnv, and whether a file's nearest tsconfig sets
 * isolatedDeclarations.
 */
import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

import { SCANNED_EXTENSIONS } from "../check-env-values.constants.ts";
import { FIXTURES_DIR } from "../fixtures.constants.ts";
import { isTestFile } from "../test-files.ts";
import { KEYS_OF, OLD_CALL, PACKAGE_MANIFEST, UNWRAP } from "./env-command.constants.ts";
import { trackedFiles } from "./env-files.ts";
import type { OldPackage } from "./env-migrate-source.ts";

/** What a scan found: the files that may migrate with their text, the skips with their reason, the old packages. */
export type Scan = {
  readonly files: readonly (readonly [rel: string, text: string])[];
  readonly skipped: readonly string[];
  readonly packages: readonly OldPackage[];
};

const MENTIONS: readonly string[] = [OLD_CALL, KEYS_OF, UNWRAP];
const DEFINES = /\bfunction\s+createScriptEnv\b/u;

/** Why `rel` is skipped: it defines createScriptEnv, is a test, or is a fixture; empty when it is not. */
function skipReason(rel: string, text: string): string {
  const reasons: [boolean, string][] = [
    [DEFINES.test(text), "defines createScriptEnv"],
    [isTestFile(rel), "test"],
    [rel.split("/").includes(FIXTURES_DIR), "fixture"],
  ];

  return reasons.find(([isHit]) => isHit)?.[1] ?? "";
}

/** Whether the nearest tsconfig of `rel`, through its extends, sets isolatedDeclarations. */
export function isIsolated(root: string, rel: string): boolean {
  const config = ts.findConfigFile(path.dirname(path.join(root, rel)), (file) => ts.sys.fileExists(file));

  if (config === undefined) return false;
  const read = ts.readConfigFile(config, (file) => ts.sys.readFile(file));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(config), undefined, config);

  return parsed.options.isolatedDeclarations === true;
}

/** The package of the package.json `rel`: its name and its folder. */
function packageOf(root: string, rel: string): OldPackage {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")) /* a package.json */ as { name?: string };

  return { dir: path.posix.dirname(rel), name: String(manifest.name) };
}

/** What `root` holds to migrate; see the file comment. */
export function scan(root: string): Scan {
  const tracked = trackedFiles(root).toSorted();
  const scanned = tracked.filter((rel) => SCANNED_EXTENSIONS.includes(path.posix.extname(rel)));
  const texts = scanned.map((rel): [string, string] => [rel, fs.readFileSync(path.join(root, rel), "utf8")]);
  const marked = texts.filter(([, text]) => MENTIONS.some((name) => text.includes(name)));
  const definers = marked.filter(([, text]) => DEFINES.test(text)).map(([rel]) => rel);

  const packages = tracked
    .filter((rel) => path.posix.basename(rel) === PACKAGE_MANIFEST)
    .filter((rel) => definers.some((definer) => definer.startsWith(`${path.posix.dirname(rel)}/`)))
    .map((rel) => packageOf(root, rel));

  const reasons = marked.map(([rel, text]) => ({ reason: skipReason(rel, text), rel, text }));
  const skipped = reasons.filter(({ reason }) => reason !== "").map(({ reason, rel }) => `${rel} (${reason})`);
  const files = reasons.filter(({ reason }) => reason === "").map(({ rel, text }) => [rel, text] as const);

  return { files, packages, skipped };
}
