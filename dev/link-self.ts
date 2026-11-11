#!/usr/bin/env bun
/**
 * This repo only: bun never links a root package's own bin or the package itself, so hooks, `bun repo`
 * and `@workerstack/repo/...` paths would find nothing here. Link `node_modules/.bin/repo` to
 * `bin/repo.ts` and `node_modules/@workerstack/repo` to the root, so this checkout has a consumer's layout.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { childEnv } from "../cli/env.ts";
import { toolEnv } from "../cli/scripts/tool-env.ts";
import * as K from "./link-self.constants.ts";
import { SYNC_ARGS, WINDOWS } from "./sync-args.constants.ts";

type Result = "linked" | "current";

/** Where a link points: `target` relative to the link's dir, `abs` the absolute path a win32 junction needs. */
type LinkTo = { target: string; abs: string; dir: boolean };

/** Make `link` a symlink to `to.target` (a junction to `to.abs` on win32), replacing anything else there. */
function ensureLink(link: string, { target, abs, dir }: LinkTo): Result {
  const win = process.platform === WINDOWS && dir;
  const want = win ? abs : target;
  let current: string | null = null;
  try {
    current = fs.readlinkSync(link);
  } catch {
    current = null;
  }
  if (current !== null && path.normalize(current) === path.normalize(want)) return "current";
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.rmSync(link, { force: true, recursive: true });
  fs.symlinkSync(want, link, win ? "junction" : undefined);
  return "linked";
}

/** What a bin's first line says to run it with: the command line up to the file, and whether it is bun or node. */
export type Shebang = { launcher: string; nodeOrBun: boolean };

/** The launcher bun picks from a bin's extension when the file has no usable shebang; null for an unknown one. */
function launcherFromPath(binPath: string): Shebang | null {
  const name = binPath.slice(Math.max(binPath.lastIndexOf("\\"), binPath.lastIndexOf("/")) + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = name.slice(dot);
  if (K.RUN_WITH_BUN.includes(ext)) return { launcher: K.BUN_LAUNCHER, nodeOrBun: true };
  if (K.RUN_WITH_CMD.includes(ext.toLowerCase())) return { launcher: K.CMD_LAUNCHER, nodeOrBun: false };
  if (ext === K.POWERSHELL_EXTENSION) return { launcher: K.POWERSHELL_LAUNCHER, nodeOrBun: false };
  return null;
}

/**
 * Bun's shebang reading (`Shebang::parse` in BinLinkingShim.rs): `#!/usr/bin/env [-S] prog args` launches
 * `prog args`, any other `#!line` launches that line, and no usable shebang falls back to the extension.
 */
export function shebangOf(contents: string, binPath: string): Shebang | null {
  const head = contents.slice(0, K.MAX_SHEBANG_INPUT);
  const newline = head.indexOf("\n");
  if (!head.startsWith(K.SHEBANG_MARK) || newline < 0) return launcherFromPath(binPath);
  const end = head[newline - 1] === "\r" ? newline - 1 : newline;
  const line = head.slice(K.SHEBANG_MARK.length, end);
  const [first = ""] = line.trimStart().split(" ");
  if (first === "") return launcherFromPath(binPath);
  if (!K.ENV_PROGRAMS.includes(first)) return { launcher: line, nodeOrBun: false };
  let rest = line.trimStart().slice(first.length).trimStart();
  if (rest.startsWith(K.SPLIT_STRING_FLAG)) rest = rest.slice(K.SPLIT_STRING_FLAG.length).trimStart();
  const [program = ""] = rest.split(" ");
  if (program === "") return launcherFromPath(binPath);
  return { launcher: rest, nodeOrBun: K.BUN_PROGRAMS.includes(program) };
}

/**
 * The bytes of a `.bunx` file, as `encode_into` in bun's BinLinkingShim.rs writes them (little endian):
 * `[binPath utf16]["][0][launcher utf16][space][u32 binPath bytes][u32 launcher+space bytes][u16 flags]`,
 * the launcher part and its two lengths only when there is a shebang. `binPath` is relative to the parent of
 * `.bin` unless `absolute`.
 */
export function encodeBunx(binPath: string, absolute: boolean, shebang: Shebang | null): Uint8Array {
  const launcher = shebang ? `${shebang.launcher} ` : "";
  const text = `${binPath}"\0${launcher}`;
  const lengths = shebang ? K.LENGTH_FIELDS_BYTES : 0;
  const out = new DataView(new ArrayBuffer(text.length * K.UTF16_BYTES + lengths + K.FLAGS_BYTES));
  for (let i = 0; i < text.length; i++) out.setUint16(i * K.UTF16_BYTES, text.charCodeAt(i), true);
  let at = text.length * K.UTF16_BYTES;
  let flags = K.SHIM_VERSION << K.VERSION_SHIFT;
  if (shebang) {
    out.setUint32(at, binPath.length * K.UTF16_BYTES, true);
    out.setUint32(at + K.U32_BYTES, launcher.length * K.UTF16_BYTES, true);
    at += lengths;
    const isNode =
      shebang.launcher.startsWith(K.NODE) &&
      (shebang.launcher.length === K.NODE.length || shebang.launcher[K.NODE.length] === " ");
    flags |= K.FLAG_SHEBANG | (shebang.nodeOrBun ? K.FLAG_NODE_OR_BUN : 0) | (isNode ? K.FLAG_NODE : 0);
  }
  if (absolute) flags |= K.FLAG_ABSOLUTE;
  out.setUint16(at, flags, true);
  return new Uint8Array(out.buffer);
}

/** The bytes of a file, or null when it cannot be read. */
function readBytes(file: string): Buffer | null {
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

/** The first `.exe` shim bun left in `.bin` other than ours, by name; undefined when there is none. */
function firstShim(bin: string): string | undefined {
  const names = fs.existsSync(bin) ? fs.readdirSync(bin) : [];
  return names.filter((name) => name.endsWith(K.SHIM_EXE) && name !== `repo${K.SHIM_EXE}`).sort()[0];
}

/**
 * On Windows bun runs a dependency bin through `<name>.exe` (a copy of its generic shim) and `<name>.bunx` beside
 * it, so a plain link is "Script not found". Copies the first `.exe` shim already in `.bin` and writes the `.bunx`.
 */
function ensureShim(root: string): Result {
  const bin = path.join(root, "node_modules", ".bin");
  const target = path.join(root, "bin", "repo.ts");
  const fromBin = path.relative(bin, target).replaceAll("/", "\\");
  const absolute = !fromBin.startsWith("..\\");
  const binPath = absolute ? path.resolve(target) : fromBin.slice("..\\".length);
  const wanted = encodeBunx(binPath, absolute, shebangOf(fs.readFileSync(target, "utf8"), binPath));
  const exe = path.join(bin, `repo${K.SHIM_EXE}`);
  const bunx = path.join(bin, `repo${K.BUNX}`);
  const current = readBytes(bunx);
  if (current && Buffer.from(wanted).equals(current) && fs.existsSync(exe)) return "current";
  const shim = firstShim(bin);
  if (shim === undefined)
    throw new Error(`link-self: no ${K.SHIM_EXE} shim in ${bin} to copy as repo${K.SHIM_EXE}; run bun install first`);

  fs.rmSync(path.join(bin, "repo"), { force: true });
  fs.copyFileSync(path.join(bin, shim), exe);
  fs.writeFileSync(bunx, wanted);
  return "linked";
}

/** Link the bin and the package itself into `<root>/node_modules`; `platform` is Windows to write a shim pair. */
export function linkSelf(root: string, platform: string = process.platform): { bin: Result; pkg: Result } {
  const modules = path.join(root, "node_modules");
  const binTo = { abs: path.join(root, "bin", "repo.ts"), dir: false, target: path.join("..", "..", "bin", "repo.ts") };
  const pkgTo = { abs: path.resolve(root), dir: true, target: path.join("..", "..") };
  return {
    bin: platform === WINDOWS ? ensureShim(root) : ensureLink(path.join(modules, ".bin", "repo"), binTo),
    pkg: ensureLink(path.join(modules, "@workerstack", "repo"), pkgTo),
  };
}

/** Runs `repo sync --postinstall` in `cwd` with the terminal inherited; returns its exit code. */
function runSync(cwd: string): number {
  const result = spawnSync(process.execPath, SYNC_ARGS, { cwd, env: toolEnv(childEnv()), stdio: "inherit" });
  return result.status ?? 1;
}

/** Link the bin and the package, then sync; returns the sync's exit code. */
export function linkAndSync(root: string, sync: (cwd: string) => number = runSync): number {
  linkSelf(root);
  return sync(root);
}

if (import.meta.main) process.exitCode = linkAndSync(process.cwd());
