import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { z } from "zod";
import type { LinkIo } from "../link-io.types.ts";
import { removeTemps } from "./remove-temps.ts";

const MODULES = "node_modules";

/** Writes `files` (relative path to text) under `root`. */
export function put(root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
}

/** A sibling checkout of one package: package.json, index.js and an empty install dir. */
export function sibling(dir: string, name: string, version: string, extra: object = {}): void {
  put(dir, {
    "package.json": JSON.stringify({ name, version, main: "index.js", dependencies: { zod: "^4" }, ...extra }),
    "index.js": `module.exports = "${version}"\n`,
  });
  fs.mkdirSync(path.join(dir, MODULES), { recursive: true });
}

/** A workspace sibling: a private root and one package per `[name, dir]`. */
export function workspace(dir: string, packages: readonly (readonly [string, string])[]): void {
  put(dir, { "package.json": JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }) });
  fs.mkdirSync(path.join(dir, MODULES), { recursive: true });
  for (const [name, sub] of packages) sibling(path.join(dir, "packages", sub), name, "1.0.0");
}

/** The installed version file of an npm copy. */
export function npmCopy(root: string, name: string, version: string): void {
  put(path.join(root, MODULES, name), { "package.json": JSON.stringify({ name, version }), "index.js": "npm\n" });
}

/** The scene: `<base>/repo` (this checkout, uses flare, npm has 0.3.2) beside `<base>/flare`. */
export type World = {
  base: string;
  main: string;
  flare: string;
  out: string[];
  err: string[];
  installs: string[];
  io: (over?: Partial<LinkIo>) => LinkIo;
};

/** Builds the scene in a temp dir; the caller removes `base`. */
export function world(): World {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "link-")));
  const main = path.join(base, "repo");
  const flare = path.join(base, "flare");
  put(main, {
    "package.json": JSON.stringify({ name: "app", private: true, dependencies: { "@workerstack/flare": "^0.3.0" } }),
    "bun.lock": "lock\n",
  });
  npmCopy(main, "@workerstack/flare", "0.3.2");
  put(main, { "node_modules/zod/package.json": JSON.stringify({ name: "zod", version: "3.24.1" }) });
  sibling(flare, "@workerstack/flare", "0.4.0-dev");
  const out: string[] = [];
  const err: string[] = [];
  const installs: string[] = [];
  const io = (over: Partial<LinkIo> = {}): LinkIo => ({
    cwd: main,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    git: (_cwd, args) => (args.includes("--git-common-dir") ? path.join(main, ".git") : main),
    install: (root) => {
      installs.push(root);
      return { code: 0, output: "" };
    },
    now: () => new Date(2026, 10, 10, 8, 31),
    ...over,
  });
  return { base, main, flare, out, err, installs, io };
}

/** The package most cases link. */
export const NAME = "@workerstack/flare";
/** What `link status` and `unlink` print when nothing is linked. */
export const NONE = "No links; every package comes from npm.";
/** What a bad command line prints. */
export const USAGE =
  "repo link: usage: repo link <name> | repo link status | repo link --pre-push; repo unlink <name> | --all";

const worlds: World[] = [];
afterEach(() => {
  removeTemps(worlds.splice(0).map((w) => w.base));
});

/** A fresh scene, removed after the test. */
export function scene(): World {
  const w = world();
  worlds.push(w);
  return w;
}

/** `path.join` under the install dir of `root`. */
export const mod = (root: string, ...parts: string[]): string => path.join(root, MODULES, ...parts);
/** The state file of an install root. */
export const stateFile = (root: string): string => path.join(root, ".repo", "tmp", "links.json");

/** The text of the file at `parts`. */
export const read = (...parts: string[]): string => fs.readFileSync(path.join(...parts), "utf8");

/** The version in the installed copy of `name`. */
export function versionIn(root: string, name: string): string {
  return z.object({ version: z.string() }).parse(JSON.parse(read(mod(root, name), "package.json"))).version;
}

/** The parsed state file of an install root. */
export function stateOf(root: string): { links: Record<string, { source: string; npm: string | null }> } {
  const entry = z.object({ source: z.string(), npm: z.string().nullable() });
  return z.object({ links: z.record(z.string(), entry) }).parse(JSON.parse(read(stateFile(root))));
}

/** Every file and symlink under `dir`, by relative path: its text, or `-> target` for a link. */
export function treeOf(dir: string): Record<string, string> {
  const tree: Record<string, string> = {};
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const file = path.join(entry.parentPath, entry.name);
    const rel = path.relative(dir, file);
    if (entry.isSymbolicLink()) tree[rel] = `-> ${fs.readlinkSync(file)}`;
    else if (entry.isFile()) tree[rel] = fs.readFileSync(file, "utf8");
  }
  return tree;
}
