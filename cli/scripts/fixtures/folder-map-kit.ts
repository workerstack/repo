import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { folderMap } from "../folder-map.ts";
import type { MapOptions } from "../folder-map.types.ts";

/** A temp git repo maker; untracked unignored files count, so no commit is needed. Its dirs go after each case. */
export function mapRepos(): {
  repo: (files: Record<string, string>) => string;
  map: (files: Record<string, string>, opts?: MapOptions) => string;
  track: (dir: string) => string;
} {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  const track = (dir: string): string => {
    tmpDirs.push(dir);
    return dir;
  };
  const repo = (files: Record<string, string>): string => {
    const root = track(fs.mkdtempSync(path.join(os.tmpdir(), "folder-map-")));
    spawnSync("git", ["init", "-q"], { cwd: root });
    for (const [rel, body] of Object.entries(files)) {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body);
    }
    return root;
  };
  const map = (files: Record<string, string>, opts: MapOptions = {}): string => {
    const out = folderMap({ root: repo(files), ...opts });
    if (!out) throw new Error("expected a map");
    return out.text;
  };
  return { repo, map, track };
}
