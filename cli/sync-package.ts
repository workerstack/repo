import fs from "node:fs";
import path from "node:path";

import { isString } from "./json.ts";
import { installedDir, requireManifest, type Manifest, type Marker } from "./link-installed.ts";
import type { LinkTarget } from "./link-io.types.ts";
import {
  BIN_DIR,
  MARKER_FILE,
  MODULES,
  OLD_DIR,
  PACKED_DIR,
  STAGING_DIR,
  SWAP_PREFIX,
  UNPACKED_DIR,
} from "./link.constants.ts";
import { PackError } from "./pack-error.ts";

/** Runs a command, or throws a PackError with what it printed. */
function run(command: string[], cwd: string): string {
  const result = Bun.spawnSync(command, { cwd, stderr: "pipe", stdout: "pipe" });
  const stdout = result.stdout.toString();

  if (!result.success) throw new PackError(`${result.stderr.toString()}${stdout}`.trim());

  return stdout.trim();
}

function binsOf(manifest: Manifest): [string, string][] {
  if (manifest.bin === undefined) return [];

  if (isString(manifest.bin)) return [[path.posix.basename(manifest.name), manifest.bin]];

  return Object.entries(manifest.bin);
}

function linkBins(root: string, manifest: Manifest): void {
  const bins = path.join(root, MODULES, BIN_DIR);

  for (const [bin, file] of binsOf(manifest)) {
    fs.mkdirSync(bins, { recursive: true });
    const link = path.join(bins, bin);
    fs.rmSync(link, { force: true });
    fs.symlinkSync(path.join("..", manifest.name, file), link);
  }
}

async function prepare(target: LinkTarget, temp: string): Promise<{ fresh: string; manifest: Manifest }> {
  const printed = run(["bun", "pm", "pack", "--destination", temp, "--quiet"], target.dir);
  // The last printed line is the tarball, possibly ending in a carriage return and possibly relative to `temp`.
  const tarball = path.resolve(temp, printed.slice(printed.lastIndexOf("\n") + 1).trim());
  const extracted = path.join(temp, UNPACKED_DIR);
  fs.mkdirSync(extracted);
  await new Bun.Archive(await Bun.file(tarball).bytes()).extract(extracted);
  const fresh = path.join(extracted, PACKED_DIR);
  const manifest = requireManifest(fresh);
  const marker: Marker = { name: target.name, source: target.dir };
  fs.writeFileSync(path.join(fresh, MARKER_FILE), `${JSON.stringify(marker)}\n`);

  return { fresh, manifest };
}

function place(dest: string, fresh: string, temp: string): void {
  const nested = path.join(dest, MODULES);

  if (fs.existsSync(nested)) fs.renameSync(nested, path.join(fresh, MODULES));
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (fs.existsSync(dest)) fs.renameSync(dest, path.join(temp, OLD_DIR));
  fs.renameSync(fresh, dest);
}

/**
 * Packs `target` with `bun pm pack`, extracts it (in process, with no `tar` to resolve) under the install dir's
 * staging dir and renames it over the package's dir, so a failed pack or unpack leaves the last good copy. The copy
 * keeps the old one's own nested install dir and gets a marker naming where it came from. Returns the packed
 * manifest.
 */
export async function syncPackage(root: string, target: LinkTarget): Promise<Manifest> {
  const staging = path.join(root, STAGING_DIR);
  fs.mkdirSync(staging, { recursive: true });
  const temp = fs.mkdtempSync(path.join(staging, SWAP_PREFIX));

  try {
    const { fresh, manifest } = await prepare(target, temp);
    place(installedDir(root, target.name), fresh, temp);
    linkBins(root, manifest);

    return manifest;
  } finally {
    fs.rmSync(temp, { force: true, recursive: true });
  }
}
