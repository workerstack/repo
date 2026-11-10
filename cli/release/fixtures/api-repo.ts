import fs from "node:fs";
import path from "node:path";
import { git, tempDir, write } from "../../fixtures/planted-repo.ts";
import { spawnRunner } from "../../scripts/ci-wait-run.ts";
import type { Runner } from "../../scripts/ci-wait.ts";
import { releaseApi } from "../api.ts";
import { cleanManifest, fixtureTarball } from "./tarball.ts";

export const PREFIX = "repo release api: ";
export const NAME = "@acme/fx";
export const TAG = `${NAME}@1.0.0`;
export const REGISTRY = "https://r.example/";
const ROOT_TARGET = { types: "./index.d.ts", default: "./index.js" };
const JS = "export {};\n";

/** The declarations of one version: the root file's text, and the text of `./x` and `./y` when it has them. */
export type Declarations = { index: string; x?: string; y?: string };

/** The `exports` and the files of one version of the fixture package. */
function contents(declared: Declarations): { exports: Record<string, unknown>; files: Record<string, string> } {
  const files: Record<string, string> = { "index.d.ts": declared.index, "index.js": JS };
  const exports: Record<string, unknown> = { ".": ROOT_TARGET };
  for (const [name, text] of [["x", declared.x], ["y", declared.y]] as const) {
    if (text === undefined) continue;
    exports[`./${name}`] = { types: `./${name}.d.ts`, default: `./${name}.js` };
    Object.assign(files, { [`${name}.d.ts`]: text, [`${name}.js`]: JS });
  }
  return { exports, files };
}

/** Packs the old version of the fixture package at 1.0.0, with `exports` instead of its own when given; its path. */
export function oldTarball(declared: Declarations, exports?: Record<string, unknown>): string {
  const own = contents(declared);
  return fixtureTarball(cleanManifest({ name: NAME, version: "1.0.0", exports: exports ?? own.exports }), own.files);
}

/** A git repo for the current checkout: `declared` at 1.0.0, tagged unless `tagged` is false, then one commit per message. */
export function apiRepo(declared: Declarations, messages: readonly string[], tagged = true): string {
  const dir = tempDir();
  const own = contents(declared);
  write(dir, {
    "package.json": cleanManifest({ name: NAME, version: "1.0.0", files: ["*.d.ts", "*.js"], exports: own.exports }),
    ...own.files,
  });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "chore: start");
  if (tagged) git(dir, "tag", TAG);
  for (const [index, message] of messages.entries()) {
    fs.writeFileSync(path.join(dir, "note.txt"), `${index}\n`);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", message);
  }
  return dir;
}

/** The tools `release api` takes; `bun` and `registry` default to the real bun and a made-up registry. */
export type Tools = { bun?: Runner; registry?: string };

/** Runs `release api` in `cwd`. */
export function api(cwd: string, argv: string[], tools: Tools = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const tmp = tempDir();
  const made: string[] = [];
  const code = releaseApi(argv, {
    cwd,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    git: spawnRunner("git"),
    gh: spawnRunner("gh"),
    bun: tools.bun ?? spawnRunner("bun"),
    tar: spawnRunner("tar"),
    tmp,
    mkdtemp: (prefix) => {
      const dir = fs.mkdtempSync(prefix);
      made.push(dir);
      return dir;
    },
    list: (dir) => fs.readdirSync(dir),
    rm: (dir) => fs.rmSync(dir, { recursive: true, force: true }),
    registry: tools.registry ?? REGISTRY,
  });
  return { code, out: out.join(""), err: err.join(""), tmp, made };
}
