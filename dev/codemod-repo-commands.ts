#!/usr/bin/env bun
/**
 * Rewrite every tracked invocation of a command script to `bun repo <cmd>`: `bun|node [<prefix>/].rulesync/scripts/<file>.ts`,
 * `bunx repo` (which fetches an unrelated npm package), and a bare `repo <cmd>` in backticks (no agent shell has it on PATH).
 * In code only an escaped backtick inside a message counts, so a template literal that starts with `repo map:` stays.
 * Skips tests, fixtures, CHANGELOG.md, package.json (its scripts run `repo <cmd>` under bun run) and the host trees
 * rulesync generates. Rerunnable: a second run changes nothing.
 *
 *   bun dev/codemod-repo-commands.ts    rewrite in place, print each changed file
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Each command script and the `repo` command that runs it. */
const SCRIPT_COMMANDS: Readonly<Record<string, string>> = {
  "job.ts": "job",
  "worktree.ts": "worktree",
  "lessons.ts": "lessons",
  "browser.ts": "browser",
  "google-workspace.ts": "google-workspace",
  "jev.ts": "jev",
  "listen.ts": "listen",
  "speak.ts": "speak",
  "setup.ts": "setup",
  "doctor.ts": "doctor",
  "clean.ts": "clean",
  "sync-global-settings.ts": "yolo",
  "purge-global-mcps.ts": "purge-mcps",
  "vscode-tasks.ts": "tasks",
  "folder-map.ts": "map",
};

const SKIP = [
  /\.test\.ts$/,
  /(?:^|\/)fixtures\//,
  /^CHANGELOG\.md$/,
  /^package\.json$/,
  /^dev\/codemod-repo-commands\.ts$/,
  /^\.(?:claude|codex|cursor)\//,
  /^\.grok\/(?:agents|roles)\//,
  /^\.agents\/agents\//,
];

const TEXT = /\.(?:md|ts|json|jsonc|toml)$/;

export function inScope(file: string): boolean {
  return TEXT.test(file) && !SKIP.some((re) => re.test(file));
}

const BY_PATH = /\b(?:bun|node)\s+(?:\.\/)?(?:[^\s`'"()]*\/)?\.rulesync\/scripts\/([\w-]+\.ts)\b(\s+--apply\b)?/g;

export function rewrite(text: string, file: string): string {
  const bare = file.endsWith(".md") ? /(?<![\\\w])`repo (?=[a-z])/g : /\\`repo (?=[a-z])/g;
  return text
    .replace(BY_PATH, (all, script: string, apply: string | undefined, offset: number, whole: string) => {
      const cmd = SCRIPT_COMMANDS[script];
      if (!cmd) return all;
      // yolo applies by default: the old --apply form drops the flag, the bare dry-run form gains --dry-run.
      if (script === "sync-global-settings.ts") {
        if (apply) return `bun repo ${cmd}`;
        return /^\s+--/.test(whole.slice(offset + all.length)) ? `bun repo ${cmd}` : `bun repo ${cmd} --dry-run`;
      }
      return `bun repo ${cmd}${apply ?? ""}`;
    })
    .replace(/\bbunx repo\b/g, "bun repo")
    .replace(bare, (m) => `${m.slice(0, -"repo ".length)}bun repo `);
}

if (import.meta.main) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && inScope(f));
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
