import fs from "node:fs";
import path from "node:path";
import { tempDir, write } from "../../__fixtures__/planted-repo.ts";
import { spawnRunner } from "../../scripts/ci-wait-run.ts";

const INDEX_JS = "export const a = 1;\n";
const INDEX_TYPES = "export declare const a: number;\n";
const ESM_TARGET = { types: "./index.d.ts", default: "./index.js" };

/** A package.json that publint and attw both accept, with `overrides` laid over it. */
export const cleanManifest = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: "fx",
  version: "1.0.0",
  type: "module",
  license: "MIT",
  repository: { type: "git", url: "git+https://github.com/acme/fx.git" },
  engines: { node: ">=20" },
  exports: { ".": ESM_TARGET },
  ...overrides,
});

/** The files of the clean package: an entry and its declarations. */
export const CLEAN_FILES: Record<string, string> = { "index.js": INDEX_JS, "index.d.ts": INDEX_TYPES };

/** Packs `manifest` and `files` with `bun pm pack` in a temp dir; the tarball's path. */
export function fixtureTarball(manifest: Record<string, unknown>, files: Record<string, string> = CLEAN_FILES): string {
  const dir = tempDir();
  write(dir, { "package.json": manifest, ...files });
  const dest = tempDir();
  spawnRunner("bun")(["pm", "pack", "--destination", dest, "--quiet"], dir);
  return path.join(dest, fs.readdirSync(dest).join(""));
}
