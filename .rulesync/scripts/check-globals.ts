#!/usr/bin/env bun
/**
 * Assert every payload leaf in `.rulesync/global-settings/` is present in its
 * $HOME dest (generic subset check, skips keys matching `skipKeyPattern`), and
 * that the project `.grok/config.toml` sets no [features] or [agent].
 */
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseToml } from "smol-toml";
import { isRecord } from "./hook-input.ts";
import {
  type JsonObject,
  loadManifest,
  readDest,
  readPayload,
  resolveDest,
  shouldSkip,
} from "./sync-global-settings.ts";

const APPLY_HINT = "run `bun repo sync-globals --apply`";
const PROJECT_REL = ".grok/config.toml";

/** One settings key whose payload value is missing or different in the dest. */
export interface DriftEntry {
  host: string;
  dest: string;
  key: string;
}

export interface CheckResult {
  ok: boolean;
  drift?: DriftEntry[];
  error?: string;
}

type ProjectGrok = { error: string; value?: undefined } | { value: JsonObject; error?: undefined };

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function isPlainObject(v: unknown): v is JsonObject {
  return v != null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
}

/** Leaf `[path, value]` pairs of a payload; arrays and dates are leaves. */
function leaves(obj: JsonObject, skipRe: RegExp, prefix: string[] = []): [string[], unknown][] {
  const out: [string[], unknown][] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (shouldSkip(k, skipRe)) continue;
    const next = [...prefix, k];
    if (isPlainObject(v)) out.push(...leaves(v, skipRe, next));
    else out.push([next, v]);
  }
  return out;
}

function valueAt(obj: unknown, keyPath: string[]): { found: false } | { found: true; value: unknown } {
  let cur = obj;
  for (const k of keyPath) {
    if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, k)) {
      return { found: false };
    }
    cur = cur[k];
  }
  return { found: true, value: cur };
}

export function driftLine({ host, dest, key }: DriftEntry): string {
  return `drift: ${host} ${dest} ${key}; ${APPLY_HINT}`;
}

function readProjectGrok(abs: string): ProjectGrok {
  let raw: string;
  try {
    raw = fs.readFileSync(abs, "utf8");
  } catch (err) {
    if (isRecord(err) && err.code === "ENOENT") return { error: "missing project .grok/config.toml" };
    return { error: "unreadable project .grok/config.toml" };
  }
  try {
    return { value: parseToml(raw) };
  } catch {
    return { error: "unreadable project .grok/config.toml" };
  }
}

/**
 * Manifest and payloads come from `sourceRoot` (default `workspaceRoot`), each replaced by a file of its name under
 * `consumerRoot`'s `.repo/global-settings/` (default `workspaceRoot`); the project `.grok/config.toml` from `workspaceRoot`.
 */
export function checkGlobals({
  home,
  workspaceRoot,
  sourceRoot,
  consumerRoot,
}: { home?: string; workspaceRoot?: string; sourceRoot?: string; consumerRoot?: string } = {}): CheckResult {
  const homeDir = home || process.env.HOME;
  const ws = workspaceRoot || process.cwd();
  const src = sourceRoot || ws;
  if (!homeDir) {
    return { ok: false, error: `HOME required; ${APPLY_HINT}` };
  }
  const drift: DriftEntry[] = [];
  try {
    const manifest = loadManifest(src);
    const skipRe = new RegExp(manifest.skipKeyPattern, "i");
    for (const h of manifest.hosts) {
      const payload = readPayload(src, h, consumerRoot || ws);
      const destValue = readDest(resolveDest(homeDir, h.dest), h.format, h.dest);
      for (const [keyPath, want] of leaves(payload, skipRe)) {
        const have = valueAt(destValue, keyPath);
        if (!have.found || !isDeepStrictEqual(have.value, want)) {
          drift.push({ host: h.id, dest: h.dest, key: keyPath.join(".") });
        }
      }
    }
  } catch (err) {
    const message = errorText(err);
    return { ok: false, error: message.startsWith("unreadable dest") ? `${message}; ${APPLY_HINT}` : message };
  }
  if (drift.length) return { ok: false, drift };

  const projectConfig = path.resolve(ws, PROJECT_REL);
  if (projectConfig === path.resolve(homeDir, PROJECT_REL)) {
    return { ok: true, drift };
  }
  const project = readProjectGrok(projectConfig);
  if (project.error !== undefined) return { ok: false, error: project.error };
  if (
    Object.prototype.hasOwnProperty.call(project.value, "features") ||
    Object.prototype.hasOwnProperty.call(project.value, "agent")
  ) {
    return {
      ok: false,
      error: "project .grok/config.toml must not set [features] or [agent]",
    };
  }
  return { ok: true, drift };
}

function main() {
  try {
    const result = checkGlobals({
      home: process.env.HOME,
      workspaceRoot: process.cwd(),
    });
    if (!result.ok) {
      const lines = result.drift ? result.drift.map(driftLine) : [result.error || "check-globals failed"];
      process.stderr.write(lines.join("\n") + "\n");
      return 1;
    }
    return 0;
  } catch (err) {
    process.stderr.write(errorText(err) + "\n");
    return 1;
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile || import.meta.url === pathToFileURL(invoked).href) {
  process.exit(main());
}
