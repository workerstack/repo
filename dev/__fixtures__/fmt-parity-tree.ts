// A small git tree for the fmt-parity tests: the repo's .oxfmtrc.jsonc, an ignored read-only config, a read-only synced file that is formatted, a few sources.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { tempDir } from "../../cli/sync/__fixtures__/temp-dirs.ts";
import { toolEnv } from "../../cli/scripts/tool-env.ts";
import { captureBun, captureTool } from "../../cli/scripts/lint.ts";
import type { Captured } from "../../cli/scripts/lint.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

/** A tool run that printed nothing and succeeded. */
export const CLEAN: Captured = { code: 0, stderr: "", stdout: "" };

/** Both formatters as the script runs them by default. */
export const REAL_FORMAT = {
  "bun fmt": (dir: string): Captured => captureBun(["fmt", "--no-script", "."], dir),
  oxfmt: (dir: string): Captured => captureTool("oxfmt", ["."], dir),
};

/** `bun fmt` at print width 100 while oxfmt keeps the tree's 120: one tool drifting from the other. */
export function narrowBun(dir: string): Captured {
  return captureBun(["fmt", "--no-script", "--print-width=100", "."], dir);
}

/** Both formatters as no-ops, for tests that are not about layout. */
export const NOOP_FORMAT = { "bun fmt": () => CLEAN, oxfmt: () => CLEAN };

/** A line of 110 characters: it fits the tree's width 120 and not 100. */
const MID_LINE = `{ "key": "${"v".repeat(98)}" }\n`;

const FILES: Record<string, string> = {
  ".gitignore": ".oxfmtrc.jsonc\n",
  "a.ts": 'export const greeting = "hello world, this is a fairly long string value";\n',
  "b.json": '{\n  "name": "a package name that is longer than forty characters",\n  "n": 1\n}\n',
  "c.md": "# A heading\n\nA paragraph of prose that runs on well past forty characters of text.\n",
  "long.ts": `export const wide = "${"w".repeat(90)}";\n`,
  "synced.json": MID_LINE,
};

export type Tree = { dir: string; files: string[]; tmp: string };

/** Makes a temp tree under its own temp dir; `config` and `git` switch off the two things the script requires. */
export function makeTree(options: { config?: boolean; git?: boolean } = {}): Tree {
  const dir = tempDir("fmt-parity-tree-");
  const tmp = tempDir("fmt-parity-tmp-");
  const files = Object.keys(FILES);

  for (const [name, text] of Object.entries(FILES)) fs.writeFileSync(path.join(dir, name), text);
  fs.chmodSync(path.join(dir, "synced.json"), 0o444);

  if (options.config !== false) {
    fs.copyFileSync(path.join(REPO_ROOT, ".oxfmtrc.jsonc"), path.join(dir, ".oxfmtrc.jsonc"));
    fs.chmodSync(path.join(dir, ".oxfmtrc.jsonc"), 0o444);
    files.push(".oxfmtrc.jsonc");
  }

  if (options.git !== false) spawnSync("git", ["init", "--quiet"], { cwd: dir, env: toolEnv(process.env) });

  return { dir, files, tmp };
}

/** The lines a run wrote, split by stream. */
export function lines(): { err: string[]; io: { err: (l: string) => void; out: (l: string) => void }; out: string[] } {
  const out: string[] = [];
  const err: string[] = [];

  return { err, io: { err: (l) => err.push(l), out: (l) => out.push(l) }, out };
}
