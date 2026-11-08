#!/usr/bin/env bun
/**
 * Point every tracked markdown mention of the retired generate pipeline and the old lessons dir at their replacements:
 * `.rulesync/lessons` becomes `.repo/lessons`; `bun run rulesync:generate`, `bun run repo:rulesync:generate`,
 * `repo:rulesync:generate`, `rulesync:generate` and `repo generate` become `bun repo sync` (`repo sync` where no `bun`
 * leads); the `check` spellings become `bun repo sync --check`; `repo upgrade` becomes `repo sync`.
 * Skips tests, fixtures, CHANGELOG.md, lessons, AGENTS.md (generated from the overview rule) and the host trees
 * rulesync generates. Rerunnable: a second run changes nothing.
 *
 *   bun dev/codemod-agent-paths.ts    rewrite in place, print each changed file
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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

/** Longest spellings first: `bun run …` takes the whole script call before the bare names are looked at. */
const RULES: readonly (readonly [RegExp, string])[] = [
  [/\.rulesync\/lessons/g, ".repo/lessons"],
  [/\bbun run (?:repo:)?rulesync:generate\b/g, "bun repo sync"],
  [/\bbun run (?:repo:)?rulesync:check\b/g, "bun repo sync --check"],
  [/\b(?:repo:)?rulesync:generate\b|\brepo generate\b/g, "repo sync"],
  [/\b(?:repo:)?rulesync:check\b/g, "repo sync --check"],
  [/\brepo upgrade\b/g, "repo sync"],
];

export function rewrite(text: string): string {
  return RULES.reduce((out, [pattern, to]) => out.replace(pattern, to), text);
}

if (import.meta.main) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && inScope(f) && fs.existsSync(path.join(root, f)));
  for (const f of files) {
    const abs = path.join(root, f);
    const before = fs.readFileSync(abs, "utf8");
    const after = rewrite(before);
    if (after !== before) {
      fs.writeFileSync(abs, after);
      console.log(f);
    }
  }
}
