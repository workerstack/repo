import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { STASH_ALPHABET, STASH_CAP, STASH_EXT, STASH_ID_BYTES, STASH_REL } from "./job.constants.ts";
import type { StashPlace, StashRoots } from "./job.types.ts";
import { canonicalPath, resolveRoots } from "./workspace-root.ts";

const PATH_SEP = /[\\/]/;

function stashId(): string {
  let s = "";

  for (const x of crypto.randomBytes(STASH_ID_BYTES)) s += STASH_ALPHABET.charAt(x % STASH_ALPHABET.length);

  return s;
}

function stashDir(root: string): string {
  return path.join(root, ...STASH_REL.split("/"));
}

/** The stash path to print: relative from the root, absolute from anywhere else. */
export function stashRef({ root, cwd }: StashPlace, name: string): string {
  return path.resolve(cwd) === path.resolve(root) ? `${STASH_REL}/${name}` : path.join(stashDir(root), name);
}

/** Writes `raw`, capped, to a new `<kind>-<id>.txt` in the root's stash; the path to print. */
export function writeStash(
  { cwd = process.cwd(), root = resolveRoots({}, { cwd }).root }: StashRoots | undefined = {},
  kind: string,
  raw: string | undefined,
): string {
  const dir = stashDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${kind}-${stashId()}${STASH_EXT}`;
  let body = raw ?? "";
  const buf = Buffer.from(body, "utf8");

  if (buf.length > STASH_CAP) body = buf.subarray(0, STASH_CAP).toString("utf8");

  if (!body.endsWith("\n")) body += "\n";
  fs.writeFileSync(path.join(dir, name), body);

  return stashRef({ cwd, root }, name);
}

/** The path a stash ref names: an absolute path, or `.tmp/repo/stash/<name>` from the root; null for a bare id. */
function namedPath(root: string, id: string): string | null {
  if (path.isAbsolute(id)) return id;

  return id.replaceAll("\\", "/").startsWith(`${STASH_REL}/`) ? path.join(root, id) : null;
}

/** `named` when it is a file right in the stash dir. */
function namedStash(dir: string, named: string): string | null {
  const abs = canonicalPath(path.resolve(named));

  return path.dirname(abs) === dir && fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : null;
}

/** The stash file a bare id names: exactly, with `.txt`, or as part of a name. */
function bareStash(dir: string, id: string): string | null {
  if (id.includes("..") || PATH_SEP.test(id)) return null;

  if (!fs.existsSync(dir)) return null;
  const names = fs.readdirSync(dir);
  const exact = names.find((n) => n === id || n === `${id}${STASH_EXT}`);

  if (exact !== undefined) return path.join(dir, exact);
  const hit = names.find((n) => n.includes(id) && n.endsWith(STASH_EXT));

  return hit === undefined ? null : path.join(dir, hit);
}

/** A bare id or name, `.tmp/repo/stash/<name>`, or that file's absolute path, all in the root stash. */
export function resolveStashFile(
  { cwd = process.cwd(), root = resolveRoots({}, { cwd }).root }: StashRoots | undefined = {},
  stash: string | undefined,
): string | null {
  const id = (stash ?? "").trim();

  if (id === "") return null;
  const dir = canonicalPath(stashDir(root));
  const named = namedPath(root, id);

  return named === null ? bareStash(dir, id) : namedStash(dir, named);
}
