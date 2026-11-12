/** What the folder map reads: its knobs from `.repo/map.jsonc`, and the repo's top, scope and files from git. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { isRecord } from "../json.ts";
import { CONFIG_REL, DEFAULTS, GIT_MAX_BUFFER, LIST_KEYS, NUMBER_KEYS } from "./folder-map.constants.ts";
import type { MapConfig } from "./folder-map.types.ts";
import { stripJsonc } from "./strip-jsonc.ts";

/** A trailing slash, which git's prefix ends in. */
const TRAILING_SLASH_RE = /\/$/;

function isStringList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isNumberKey(k: string): k is (typeof NUMBER_KEYS)[number] {
  return NUMBER_KEYS.some((key) => key === k);
}

function isListKey(k: string): k is (typeof LIST_KEYS)[number] {
  return LIST_KEYS.some((key) => key === k);
}

/** The config's top-level entries ({} when it is not an object), or null after a warning when it cannot be read. */
function readConfig(abs: string, warn: (msg: string) => void): Record<string, unknown> | null {
  let raw: unknown;

  try {
    raw = JSON.parse(stripJsonc(fs.readFileSync(abs, "utf8")));
  } catch (err) {
    const error = err /* readFileSync, stripJsonc and JSON.parse throw Errors */ as Error;
    warn(`repo map: ignoring ${CONFIG_REL}: ${error.message}`);

    return null;
  }

  return isRecord(raw) ? raw : {};
}

/** Sets one known key on `out` when its value is good; warns by name when it is not; skips unknown keys. */
function applyKey(out: MapConfig, [k, v]: [string, unknown], warn: (msg: string) => void): void {
  if (isNumberKey(k)) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
    else warn(`repo map: ignoring ${CONFIG_REL} key ${k}`);
  } else if (isListKey(k)) {
    if (isStringList(v)) out[k] = v;
    else warn(`repo map: ignoring ${CONFIG_REL} key ${k}`);
  }
}

/** DEFAULTS merged with known keys from CONFIG_REL; bad file → defaults + warn. */
export function loadMapConfig(
  root: string,
  warn: (msg: string) => void = (m) => process.stderr.write(`${m}\n`),
): MapConfig {
  const abs = path.join(root, CONFIG_REL);

  if (!fs.existsSync(abs)) return { ...DEFAULTS };
  const raw = readConfig(abs, warn);
  const out: MapConfig = { ...DEFAULTS };

  for (const entry of Object.entries(raw ?? {})) applyKey(out, entry, warn);

  return out;
}

function git(args: string[], cwd: string): string | null {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: GIT_MAX_BUFFER });

  return r.status === 0 ? r.stdout : null;
}

/** Repo top, or null outside git. */
export function repoRoot(cwd: string): string | null {
  const top = git(["rev-parse", "--show-toplevel"], cwd);

  return top === null || top === "" ? null : top.trim();
}

/**
 * Repo-relative posix path of `abs` ("" at the top), or null when it is not a
 * dir in a repo. Asks git so Windows short (8.3) vs long paths cannot diverge.
 */
export function repoPrefix(abs: string): string | null {
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return null;
  const prefix = git(["rev-parse", "--show-prefix"], abs);

  return prefix == null ? null : prefix.trim().replace(TRAILING_SLASH_RE, "");
}

/** Tracked + untracked-unignored files, repo-relative, posix. */
export function listFiles(root: string): string[] | null {
  const out = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], root);

  if (out == null) return null;

  return [...new Set(out.split("\0").filter(Boolean))];
}
