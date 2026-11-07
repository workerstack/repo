#!/usr/bin/env node
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
import {
  loadManifest,
  readDest,
  readPayload,
  resolveDest,
  shouldSkip,
} from "./sync-global-settings.mjs";

const APPLY_HINT = "run `bunx repo sync-globals --apply`";
const PROJECT_REL = ".grok/config.toml";

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
}

/** Leaf `[path, value]` pairs of a payload; arrays and dates are leaves. */
function leaves(obj, skipRe, prefix = []) {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (shouldSkip(k, skipRe)) continue;
    const next = [...prefix, k];
    if (isPlainObject(v)) out.push(...leaves(v, skipRe, next));
    else out.push([next, v]);
  }
  return out;
}

function valueAt(obj, keyPath) {
  let cur = obj;
  for (const k of keyPath) {
    if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, k)) {
      return { found: false };
    }
    cur = cur[k];
  }
  return { found: true, value: cur };
}

export function driftLine({ host, dest, key }) {
  return `drift: ${host} ${dest} ${key}; ${APPLY_HINT}`;
}

function readProjectGrok(abs) {
  let raw;
  try {
    raw = fs.readFileSync(abs, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return { error: "missing project .grok/config.toml" };
    return { error: "unreadable project .grok/config.toml" };
  }
  try {
    return { value: parseToml(raw) };
  } catch {
    return { error: "unreadable project .grok/config.toml" };
  }
}

export function checkGlobals({ home, workspaceRoot } = {}) {
  const homeDir = home || process.env.HOME;
  const ws = workspaceRoot || process.cwd();
  if (!homeDir) {
    return { ok: false, error: `HOME required; ${APPLY_HINT}` };
  }
  const drift = [];
  try {
    const manifest = loadManifest(ws);
    const skipRe = new RegExp(manifest.skipKeyPattern, "i");
    for (const h of manifest.hosts) {
      const payload = readPayload(ws, h);
      const destValue = readDest(resolveDest(homeDir, h.dest), h.format, h.dest);
      for (const [keyPath, want] of leaves(payload, skipRe)) {
        const have = valueAt(destValue, keyPath);
        if (!have.found || !isDeepStrictEqual(have.value, want)) {
          drift.push({ host: h.id, dest: h.dest, key: keyPath.join(".") });
        }
      }
    }
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    return { ok: false, error: message.startsWith("unreadable dest") ? `${message}; ${APPLY_HINT}` : message };
  }
  if (drift.length) return { ok: false, drift };

  const projectConfig = path.resolve(ws, PROJECT_REL);
  if (projectConfig === path.resolve(homeDir, PROJECT_REL)) {
    return { ok: true, drift };
  }
  const project = readProjectGrok(projectConfig);
  if (project.error) return { ok: false, error: project.error };
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
    process.stderr.write(String(err && err.message ? err.message : err) + "\n");
    return 1;
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile || import.meta.url === pathToFileURL(invoked).href) {
  process.exit(main());
}
