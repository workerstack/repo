import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { NAME, put, sibling, type World } from "./link-world.ts";
import { registerDependent } from "../link-dependents.ts";
import { writeState } from "../link-state.ts";

export const ZERO = "0".repeat(40);
export const REF = "refs/heads/main";
export const NO_DEPENDENTS = "No repo on this machine links this checkout.";

export function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });

  return r.stdout.trim();
}

/** Makes the scene's main checkout a git repo on `main` with one commit; returns the head id. */
export function gitMain(w: World): string {
  put(w.main, { ".gitignore": "node_modules\n.repo\n" });
  git(w.main, "init", "-q", "-b", "main");
  git(w.main, "add", ".");
  git(w.main, "commit", "-q", "-m", "one");

  return git(w.main, "rev-parse", "HEAD");
}

/** A consumer root under the scene that links `NAME` from the flare sibling, recorded in main's dependents. */
export function consumer(w: World, name: string): string {
  const root = path.join(w.base, name);
  put(root, { "node_modules/.keep": "" });
  writeState(root, { [NAME]: { npm: "0.3.2", source: w.flare, syncedAt: "2026-11-10T08:31:00.000Z" } });
  registerDependent(w.main, root, { dir: w.flare, name: NAME });

  return root;
}

export function packsLog(w: World): string[] {
  const file = path.join(w.base, "packs.log");

  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
}

export function counted(w: World): void {
  sibling(w.flare, NAME, "0.6.0", { scripts: { prepack: `echo x >> '${path.join(w.base, "packs.log")}'` } });
}

/** A stdin reader that yields `lines`, each ended by a newline. */
export function stdinOf(...lines: string[]): () => Promise<string> {
  return () => Promise.resolve(lines.map((line) => `${line}\n`).join(""));
}
