#!/usr/bin/env bun
/**
 * This repo only: bun never links a root package's own bin, so hooks and `bun repo` would find no
 * `node_modules/.bin/repo` here. Link it to `bin/repo.ts`, so this checkout has a consumer's layout.
 */
import fs from "node:fs";
import path from "node:path";

const TARGET = path.join("..", "..", "bin", "repo.ts");

/** Make `<root>/node_modules/.bin/repo` a symlink to `bin/repo.ts`, replacing anything else there. */
export function linkSelfBin(root: string): "linked" | "current" {
  const link = path.join(root, "node_modules", ".bin", "repo");
  let current: string | null = null;
  try {
    current = fs.readlinkSync(link);
  } catch {
    current = null;
  }
  if (current === TARGET) return "current";
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.rmSync(link, { force: true });
  fs.symlinkSync(TARGET, link);
  return "linked";
}

if (import.meta.main) linkSelfBin(process.cwd());
