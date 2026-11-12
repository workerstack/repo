import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { parse as parseToml, stringify as stringifyToml, type TomlTable } from "smol-toml";

/** Planted dirs under the OS temp dir, removed after each case; nothing here touches the real home. */
export function plantDirs(): (prefix: string) => string {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  return (prefix) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  };
}

/** Write `body` at `rel` under `root`, creating parent dirs. */
export function plant(root: string, rel: string, body: string): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  return abs;
}

export const DENY_ALL = {
  default: "deny",
  allow: [] as string[],
  plugins: { denyDefault: true },
};

/** Write `policy` as `<root>/agents/mcp-policy.jsonc`. */
export function plantPolicy(root: string, policy: unknown): void {
  plant(root, "agents/mcp-policy.jsonc", `// fixture\n${JSON.stringify(policy, null, 2)}\n`);
}

export function readJson(root: string, rel: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")) as Record<string, unknown>;
}

export function readToml(root: string, rel: string): TomlTable {
  return parseToml(fs.readFileSync(path.join(root, rel), "utf8"));
}

type Tree = Record<string, unknown>;

function isTree(v: unknown): v is Tree {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Set `keyPath` in `obj` to `value`; `undefined` deletes the key. Every parent table must exist. */
function setAt(obj: Tree, keyPath: string[], value: unknown): void {
  let cur = obj;
  for (const key of keyPath.slice(0, -1)) {
    const next = cur[key];
    if (!isTree(next)) throw new Error(`no table at ${key}`);
    cur = next;
  }
  const last = keyPath[keyPath.length - 1] ?? "";
  if (value === undefined) delete cur[last];
  else cur[last] = value;
}

/** Change one key of a TOML file under `root`; `undefined` deletes it. */
export function changeToml(root: string, rel: string, keyPath: string[], value: unknown): void {
  const obj = readToml(root, rel);
  setAt(obj, keyPath, value);
  fs.writeFileSync(path.join(root, rel), stringifyToml(obj));
}

/** Change one key of a JSON file under `root`; `undefined` deletes it. */
export function changeJson(root: string, rel: string, keyPath: string[], value: unknown): void {
  const obj = readJson(root, rel);
  setAt(obj, keyPath, value);
  fs.writeFileSync(path.join(root, rel), JSON.stringify(obj, null, 2) + "\n");
}

/** A JSON file under `root` in the shape the caller names. */
export function readJsonAs<T>(root: string, rel: string): T {
  const value: unknown = JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
  return value /* the caller names the shape the emitted file holds */ as T;
}

/** A TOML file under `root` in the shape the caller names. */
export function readTomlAs<T>(root: string, rel: string): T {
  const value: unknown = readToml(root, rel);
  return value /* the caller names the shape the emitted file holds */ as T;
}
