/** The global-settings manifest and the payload and dest files it names: read, parse and path checks. */
import fs from "node:fs";
import path from "node:path";

import { parse as parseToml } from "smol-toml";
import { z } from "zod";

import { isRecord, isString, type Json, readJson } from "../json.ts";
import { isSettingsTable, isTableArray, type SettingsTable } from "./settings-table.ts";
import {
  ALL_HOSTS,
  ENOENT,
  JSON_EXT,
  JSON_FORMAT,
  MANIFEST_REL,
  OVERLAY_DIR,
  TOML_FORMAT,
} from "./sync-global-settings.constants.ts";
import type { Manifest, ManifestHost, SettingsFormat } from "./sync-global-settings.types.ts";

export function resolveDest(home: string | null | undefined, dest: string | null | undefined): string {
  if (home == null || home === "") throw new Error("home required");

  if (dest == null || dest === "") throw new Error("dest required");
  const resolvedHome = path.resolve(home);
  const resolved = path.resolve(resolvedHome, dest);
  const prefix = resolvedHome.endsWith(path.sep) ? resolvedHome : resolvedHome + path.sep;

  if (resolved !== resolvedHome && !resolved.startsWith(prefix)) throw new Error(`dest not under home: ${dest}`);

  return resolved;
}

export function shouldSkip(segment: string, skipRe: RegExp | null | undefined): boolean {
  if (skipRe == null) return false;

  return skipRe.test(segment);
}

function checkedHost(h: Json): ManifestHost {
  if (!isRecord(h) || !isString(h.id) || (h.format !== JSON_FORMAT && h.format !== TOML_FORMAT))
    throw new Error("manifest host needs id and format json|toml");

  if (!isString(h.payload) || !isString(h.dest)) throw new Error(`manifest host ${h.id} needs payload and dest`);

  return { ...h, dest: h.dest, format: h.format, id: h.id, payload: h.payload };
}

/** A JSON object, or null for any other JSON value. */
function objectOrNull() {
  return z.record(z.string(), z.json()).nullable().catch(null);
}

export function loadManifest(workspaceRoot: string): Manifest {
  const raw = fs.readFileSync(path.join(workspaceRoot, MANIFEST_REL), "utf8");
  // Each key is checked below with its own message, which `repo yolo` prints as its error.
  const manifest = readJson(objectOrNull(), raw);

  if (manifest === null) throw new Error("invalid manifest");
  const { skipKeyPattern, hosts } = manifest;

  if (!isString(skipKeyPattern)) throw new Error("manifest skipKeyPattern required");

  if (!Array.isArray(hosts)) throw new Error("manifest hosts required");

  return { ...manifest, hosts: hosts.map(checkedHost), skipKeyPattern };
}

export function hostIdsOf(manifest: Manifest): Set<string> {
  return new Set([...manifest.hosts.map((h) => h.id), ALL_HOSTS]);
}

/** Parse payload or dest text as `format`; empty text is `{}`. Throws on bad syntax. */
export function parseText(raw: string | null | undefined, format: SettingsFormat): SettingsTable {
  const s = raw ?? "";

  if (s.trim() === "") return {};
  const v = format === JSON_FORMAT ? readJson(objectOrNull(), s) : parseToml(s);

  if (v === null) throw new Error("not an object");

  return v;
}

function isMissing(cause: unknown): boolean {
  return cause instanceof Error && "code" in cause && cause.code === ENOENT;
}

/** Read a dest file; a missing file is `{}`, anything unreadable throws `unreadable dest: <label>`. */
export function readDest(destAbs: string, format: SettingsFormat, label: string): SettingsTable {
  let raw: string;

  try {
    raw = fs.readFileSync(destAbs, "utf8");
  } catch (err) {
    if (isMissing(err)) return {};
    throw new Error(`unreadable dest: ${label}`, { cause: err });
  }

  try {
    return parseText(raw, format);
  } catch {
    throw new Error(`unreadable dest: ${label}`);
  }
}

/**
 * Read a host payload; a missing file throws `missing payload: <rel>`, bad syntax `unreadable payload: <rel>`.
 * A file of the payload's name under `<consumerRoot>/.repo/global-settings/` replaces the stock payload whole.
 */
export function readPayload(workspaceRoot: string, host: ManifestHost, consumerRoot?: string): SettingsTable {
  const overlay = consumerRoot === undefined ? null : path.join(consumerRoot, OVERLAY_DIR, path.basename(host.payload));
  const abs = overlay !== null && fs.existsSync(overlay) ? overlay : path.join(workspaceRoot, host.payload);
  let raw: string;

  try {
    raw = fs.readFileSync(abs, "utf8");
  } catch (err) {
    if (isMissing(err)) throw new Error(`missing payload: ${host.payload}`, { cause: err });
    throw new Error(`unreadable payload: ${host.payload}`, { cause: err });
  }

  try {
    return parseText(raw, host.format);
  } catch {
    throw new Error(`unreadable payload: ${host.payload}`);
  }
}

/** The first key of `payload` holding a list of rules where `dest` holds something else, as a dotted path. */
function nonArrayKey(payload: SettingsTable, dest: SettingsTable, prefix: string[] = []): string | null {
  for (const [k, v] of Object.entries(payload)) {
    const have = dest[k];
    const keyPath = [...prefix, k];

    if (isTableArray(v) && have !== undefined && !Array.isArray(have)) return keyPath.join(".");

    if (isSettingsTable(v) && isSettingsTable(have)) {
      const nested = nonArrayKey(v, have, keyPath);

      if (nested !== null) return nested;
    }
  }

  return null;
}

/**
 * Why a host's dest must be left as it is, or null. A `.json` dest with a `.jsonc` file beside it is not the file the
 * tool reads, and a list of rules would replace a dest value that is not a list.
 */
export function skipReason(destAbs: string, dest: SettingsTable, payload: SettingsTable): string | null {
  if (destAbs.endsWith(JSON_EXT) && fs.existsSync(`${destAbs}c`)) return `${path.basename(destAbs)}c exists`;
  const key = nonArrayKey(payload, dest);

  return key === null ? null : `${key} is not an array`;
}
