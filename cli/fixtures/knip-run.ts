import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { KnipRun } from "../knip-check.ts";
import type { Workspace } from "../sync/workspace.ts";

const dirs: string[] = [];

/** Removes every root `knipRoot` made; call it from an `afterEach`. */
export function removeKnipRoots(): void {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

/** A temp root holding `files` (path to text) and a manifest declaring `dependencies`, as its workspace. */
export function knipRoot(files: Record<string, string>, dependencies: Record<string, string> = {}): Workspace {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-knip-")));
  dirs.push(root);
  const manifest = { name: "app", dependencies };
  const all = { "package.json": JSON.stringify({ ...manifest, type: "module" }), ...files };
  for (const [rel, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return { root, manifest, packages: [] };
}

/** One knip json report: per file, the issues by type. */
export const report = (...issues: Record<string, unknown>[]): string => JSON.stringify({ issues });

/** A runner that answers with `stdout`, `code` and `stderr`, and records the arguments and cwd it was called with. */
export function answering(stdout: string, code = 0, stderr = ""): KnipRun & { calls: [string[], string][] } {
  const calls: [string[], string][] = [];
  const run = (args: string[], cwd: string) => {
    calls.push([args, cwd]);
    return { code, stdout, stderr };
  };
  return Object.assign(run, { calls });
}
