#!/usr/bin/env bun
/**
 * Point every tracked markdown mention of the stock references at the package: `.rulesync/reference/<file>.md` becomes
 * `node_modules/@workerstack/repo/references/<file>.md` and a bare `.rulesync/reference/` the directory. The removed
 * `law.md`, `skills-map.md` and `refs-map.md` become `references/INDEX.md`, which now holds their catalogs. Inside
 * `references/` a `../` prefix on a `.rulesync/` or `.grok/` path is dropped: it names the consumer's root file, and
 * from the package copy `../` would land in `node_modules/@workerstack/`.
 * Skips tests, fixtures, CHANGELOG.md, lessons, AGENTS.md (generated from the overview rule) and the host trees rulesync
 * generates. Rerunnable: a second run changes nothing.
 *
 *   bun dev/codemod-reference-paths.ts    rewrite in place, print each changed file
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PKG_REFS = "node_modules/@workerstack/repo/references/";

const SKIP = [
  /\.test\.ts$/,
  /(?:^|\/)fixtures\//,
  /^CHANGELOG\.md$/,
  /^AGENTS\.md$/,
  /^\.repo\/lessons\//,
  /^\.(?:claude|codex|cursor)\//,
  /^\.grok\/(?:agents|roles)\//,
  /^\.agents\/agents\//,
];

export function inScope(file: string): boolean {
  return file.endsWith(".md") && !SKIP.some((re) => re.test(file));
}

const REMOVED = /\.rulesync\/reference\/(?:law|skills-map|refs-map)\.md/g;
const FILE = /\.rulesync\/reference\/([\w-]+\.md)/g;
const DIR = /\.rulesync\/reference\/?/g;
const UP = /(?<![\w./])(?:\.\.\/)+(?=\.(?:rulesync|grok)\/)/g;

export function rewrite(text: string, file: string): string {
  let out = text
    .replace(REMOVED, `${PKG_REFS}INDEX.md`)
    .replace(FILE, (_all, name: string) => `${PKG_REFS}${name}`)
    .replace(DIR, PKG_REFS);
  if (file.startsWith("references/")) out = out.replace(UP, "");
  return out;
}

if (import.meta.main) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && inScope(f) && fs.existsSync(path.join(root, f)));
  for (const f of files) {
    const abs = path.join(root, f);
    const before = fs.readFileSync(abs, "utf8");
    const after = rewrite(before, f);
    if (after !== before) {
      fs.writeFileSync(abs, after);
      console.log(f);
    }
  }
}
