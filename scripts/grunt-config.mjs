/** Load committed jsonc + local overlay. leftoverGate/spawnMode keys are ignored leftovers from 0.5. */
import fs from "node:fs";
import path from "node:path";

export const CONFIG_REL = ".rulesync/grunt.config.jsonc";
export const LOCAL_CONFIG_REL = ".rulesync/grunt.config.local.jsonc";
export const SESSION_GATES = new Set(["auto", "ask"]);

export function stripJsonc(text) {
  return String(text ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function parseJsoncFile(abs) {
  try {
    const raw = fs.readFileSync(abs, "utf8");
    const obj = JSON.parse(stripJsonc(raw));
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    return obj;
  } catch {
    return null;
  }
}

function overlaySessionGate(base, extra) {
  if (!extra) return base;
  const out = { ...base };
  if (extra.sessionGate === "auto" || extra.sessionGate === "ask") {
    out.sessionGate = extra.sessionGate;
  }
  return out;
}

/** @returns {object|null} committed config when version is 1 */
export function loadConfig(workspaceRoot) {
  if (!workspaceRoot) return null;
  const committed = parseJsoncFile(path.join(workspaceRoot, CONFIG_REL));
  if (!committed || committed.version !== 1) return null;
  return committed;
}

/** @returns {"auto"|"ask"} fail-closed auto */
export function loadSessionGate(workspaceRoot) {
  if (!workspaceRoot) return "auto";
  const committed = parseJsoncFile(path.join(workspaceRoot, CONFIG_REL));
  if (!committed || committed.version !== 1) return "auto";
  const obj = overlaySessionGate(
    committed,
    parseJsoncFile(path.join(workspaceRoot, LOCAL_CONFIG_REL)),
  );
  if (obj.sessionGate === "auto" || obj.sessionGate === "ask") {
    return obj.sessionGate;
  }
  return "auto";
}

/** Warn when a 0.5 leftoverGate/spawnMode key is still on disk. */
export function leftoverKeysWarn(workspaceRoot) {
  if (!workspaceRoot) return "";
  for (const rel of [CONFIG_REL, LOCAL_CONFIG_REL]) {
    const obj = parseJsoncFile(path.join(workspaceRoot, rel));
    if (!obj) continue;
    if ("leftoverGate" in obj || "spawnMode" in obj) {
      return `warn: ${rel} still has leftoverGate/spawnMode; ignored in 0.6`;
    }
  }
  return "";
}
