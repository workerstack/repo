import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { checkWorkspace } from "../check-workspace.ts";
import { readWorkspace } from "../sync/workspace.ts";
import { removeTemps } from "./remove-temps.ts";

const temps: string[] = [];
afterEach(() => {
  removeTemps(temps.splice(0));
});

export const ROOT = { private: true, workspaces: ["packages/*"], catalog: { zod: "^4.0.0", vitest: "^4.0.0" } };
export const LOCK_OK = JSON.stringify({ packages: { zod: ["zod@4.1.12", "", {}, "x"] } });

/** Writes the manifests and the lock text into a temp repo, reads it as `repo check` does and returns the lines. */
export function lines(files: Record<string, object>, lock?: string, extra: Record<string, string> = {}): string[] {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-check-workspace-"));
  temps.push(root);
  const all: Record<string, string> = { ...extra };
  for (const [rel, content] of Object.entries(files)) all[rel] = JSON.stringify(content);
  if (lock !== undefined) all["bun.lock"] = lock;
  for (const [rel, content] of Object.entries(all)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  const result = readWorkspace(root);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return checkWorkspace(root, result.workspace);
}

export const MANIFEST = "package.json";
export const pkg = (name: string, rest: object): Record<string, object> => ({
  [MANIFEST]: ROOT,
  [`packages/${name}/${MANIFEST}`]: { name, ...rest },
});
