#!/usr/bin/env bun
/**
 * Merge each manifest host payload (`agents/global-settings/*`) into its
 * dotfile under $HOME: claude, codex, grok, antigravity and cursor full-permission
 * keys. Payload keys win; unrelated dest keys survive. Applies by default;
 * `--dry-run` only reports, `--check` reports drift per host.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkHint, checkHosts, checkLine, projectConfigError } from "./check-globals.ts";
import { isRecord } from "./hook-input.ts";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { readEnv } from "../env.ts";

/** The package root, two levels above `cli/scripts/`: where the stock manifest and payloads live. */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST_REL = "agents/global-settings/manifest.json";

export type JsonObject = Record<string, unknown>;
export type SettingsFormat = "json" | "toml";

/** One host in the manifest: the payload file in the repo and the dotfile under $HOME it merges into. */
export interface ManifestHost {
  id: string;
  format: SettingsFormat;
  payload: string;
  dest: string;
}

export interface Manifest {
  skipKeyPattern: string;
  hosts: ManifestHost[];
}

export type ParsedArgv = { ok: true; dryRun: boolean; check: boolean; host: string } | { ok: false; error: string };

export interface ReportRow {
  action: string;
  id: string;
  dest: string;
  line: string;
}

export interface SyncResult {
  ok: boolean;
  report: ReportRow[];
  error?: string;
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function parseArgv(argv: unknown): ParsedArgv {
  const args: unknown[] = Array.isArray(argv) ? argv : [];
  let dryRun = false;
  let check = false;
  let host = "all";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (a === "--check") {
      check = true;
      continue;
    }
    if (a === "--host") {
      const v = args[++i];
      if (typeof v !== "string" || !v) {
        return { ok: false, error: "unknown host: " };
      }
      host = v;
      continue;
    }
    if (typeof a === "string" && a.startsWith("--host=")) {
      const v = a.slice("--host=".length);
      if (!v) {
        return { ok: false, error: "unknown host: " };
      }
      host = v;
      continue;
    }
    return { ok: false, error: `unknown flag: ${a}` };
  }
  if (check && dryRun) return { ok: false, error: "--check and --dry-run do not combine" };
  return { ok: true, dryRun, check, host };
}

export function resolveDest(home: string | null | undefined, dest: string | null | undefined): string {
  if (!home) throw new Error("home required");
  if (dest == null || dest === "") throw new Error("dest required");
  const resolvedHome = path.resolve(home);
  const resolved = path.resolve(resolvedHome, dest);
  const prefix = resolvedHome.endsWith(path.sep) ? resolvedHome : resolvedHome + path.sep;
  if (resolved !== resolvedHome && !resolved.startsWith(prefix)) {
    throw new Error(`dest not under home: ${dest}`);
  }
  return resolved;
}

export function shouldSkip(segment: unknown, skipRe: RegExp | null | undefined): boolean {
  if (!skipRe) return false;
  return skipRe.test(String(segment));
}

function isPlainObject(v: unknown): v is JsonObject {
  return v != null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
}

export function deepMerge(
  dest: unknown,
  source: unknown,
  skipRe: RegExp | null | undefined,
  keyPath: string[] = [],
): JsonObject {
  const out: JsonObject = isPlainObject(dest) ? { ...dest } : {};
  if (!isPlainObject(source)) return out;
  for (const [k, v] of Object.entries(source)) {
    const nextPath = [...keyPath, k];
    if (nextPath.some((seg) => shouldSkip(seg, skipRe))) continue;
    const prev = out[k];
    if (isPlainObject(v) && isPlainObject(prev)) {
      out[k] = deepMerge(prev, v, skipRe, nextPath);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function loadManifest(workspaceRoot: string): Manifest {
  const p = path.join(workspaceRoot, MANIFEST_REL);
  const raw = fs.readFileSync(p, "utf8");
  const manifest: unknown = JSON.parse(raw);
  if (!isRecord(manifest)) {
    throw new Error("invalid manifest");
  }
  const { skipKeyPattern, hosts } = manifest;
  if (typeof skipKeyPattern !== "string") {
    throw new Error("manifest skipKeyPattern required");
  }
  if (!Array.isArray(hosts)) {
    throw new Error("manifest hosts required");
  }
  const checked: ManifestHost[] = [];
  for (const h of hosts) {
    if (!isRecord(h) || typeof h.id !== "string" || (h.format !== "json" && h.format !== "toml")) {
      throw new Error("manifest host needs id and format json|toml");
    }
    if (typeof h.payload !== "string" || typeof h.dest !== "string") {
      throw new Error(`manifest host ${h.id} needs payload and dest`);
    }
    checked.push({ ...h, id: h.id, format: h.format, payload: h.payload, dest: h.dest });
  }
  return { ...manifest, skipKeyPattern, hosts: checked };
}

export function hostIdsOf(manifest: Manifest): Set<string> {
  return new Set([...manifest.hosts.map((h) => h.id), "all"]);
}

/** Parse payload or dest text as `format`; empty text is `{}`. Throws on bad syntax. */
export function parseText(raw: unknown, format: SettingsFormat): JsonObject {
  const s = String(raw ?? "");
  if (!s.trim()) return {};
  const v: unknown = format === "json" ? JSON.parse(s) : parseToml(s);
  if (!isPlainObject(v)) throw new Error("not an object");
  return v;
}

/** Read a dest file; a missing file is `{}`, anything unreadable throws `unreadable dest: <label>`. */
export function readDest(destAbs: string, format: SettingsFormat, label: string): JsonObject {
  let raw: string;
  try {
    raw = fs.readFileSync(destAbs, "utf8");
  } catch (err) {
    if (isRecord(err) && err.code === "ENOENT") return {};
    throw new Error(`unreadable dest: ${label}`);
  }
  try {
    return parseText(raw, format);
  } catch {
    throw new Error(`unreadable dest: ${label}`);
  }
}

export const OVERLAY_DIR = ".repo/global-settings";

/**
 * Read a host payload; a missing file throws `missing payload: <rel>`, bad syntax `unreadable payload: <rel>`. A file of
 * the payload's name under `<consumerRoot>/.repo/global-settings/` replaces the stock payload whole.
 */
export function readPayload(workspaceRoot: string, host: ManifestHost, consumerRoot?: string): JsonObject {
  const overlay = consumerRoot === undefined ? null : path.join(consumerRoot, OVERLAY_DIR, path.basename(host.payload));
  const abs = overlay !== null && fs.existsSync(overlay) ? overlay : path.join(workspaceRoot, host.payload);
  let raw: string;
  try {
    raw = fs.readFileSync(abs, "utf8");
  } catch (err) {
    if (isRecord(err) && err.code === "ENOENT") throw new Error(`missing payload: ${host.payload}`);
    throw new Error(`unreadable payload: ${host.payload}`);
  }
  try {
    return parseText(raw, host.format);
  } catch {
    throw new Error(`unreadable payload: ${host.payload}`);
  }
}

function stringifyDest(value: JsonObject, format: SettingsFormat): string {
  const body = format === "json" ? JSON.stringify(value, null, 2) : stringifyToml(value);
  return body.endsWith("\n") ? body : body + "\n";
}

function reportRow({ action, id, dest }: { action: string; id: string; dest: string }): ReportRow {
  return { action, id, dest, line: `${action} ${id} ${dest}` };
}

/**
 * Manifest and payloads come from `sourceRoot` (default `workspaceRoot`); a payload under `consumerRoot`'s
 * `.repo/global-settings/` (default `workspaceRoot`) replaces the stock one. Only `home` is written.
 */
export function syncGlobals({
  workspaceRoot,
  sourceRoot,
  consumerRoot,
  home,
  apply = false,
  host = "all",
}: {
  workspaceRoot?: string;
  sourceRoot?: string;
  consumerRoot?: string;
  home?: string;
  apply?: boolean;
  host?: string;
} = {}): SyncResult {
  const report: ReportRow[] = [];
  const action = apply ? "apply" : "dry-run";
  try {
    const consumer = consumerRoot || workspaceRoot || process.cwd();
    const ws = sourceRoot || workspaceRoot || process.cwd();
    const manifest = loadManifest(ws);
    if (!hostIdsOf(manifest).has(host)) {
      return { ok: false, report, error: `unknown host: ${host}` };
    }
    const skipRe = new RegExp(manifest.skipKeyPattern, "i");
    for (const h of manifest.hosts.filter((x) => host === "all" || x.id === host)) {
      const source = readPayload(ws, h, consumer);
      const destAbs = resolveDest(home, h.dest);
      const merged = deepMerge(readDest(destAbs, h.format, h.dest), source, skipRe);
      if (apply) {
        fs.mkdirSync(path.dirname(destAbs), { recursive: true });
        fs.writeFileSync(destAbs, stringifyDest(merged, h.format));
      }
      report.push(reportRow({ action, id: h.id, dest: h.dest }));
    }
    return { ok: true, report };
  } catch (err) {
    return { ok: false, report, error: errorText(err) };
  }
}

/** `--check`: one line of per-host status, the hint on drift, then any project config error. */
function runCheck(home: string, host: string): number {
  const cwd = process.cwd();
  let statuses: ReturnType<typeof checkHosts>;
  try {
    statuses = checkHosts({ home, workspaceRoot: cwd, sourceRoot: PACKAGE_ROOT, consumerRoot: cwd, host });
  } catch (err) {
    process.stderr.write(errorText(err) + "\n");
    return 1;
  }
  process.stdout.write(checkLine(statuses) + "\n");
  const hint = checkHint(statuses);
  if (hint) process.stdout.write(hint + "\n");
  const projectError = projectConfigError(cwd, home);
  if (projectError) process.stderr.write(projectError + "\n");
  return hint || projectError || statuses.some((s) => s.state !== "ok") ? 1 : 0;
}

export function main(argv: string[]): number {
  try {
    const parsed = parseArgv(argv);
    if (!parsed.ok) {
      process.stderr.write(parsed.error + "\n");
      return 1;
    }
    const home = readEnv().HOME;
    if (!home) {
      process.stderr.write("HOME required\n");
      return 1;
    }
    if (parsed.check) return runCheck(home, parsed.host);
    const result = syncGlobals({
      workspaceRoot: process.cwd(),
      sourceRoot: PACKAGE_ROOT,
      consumerRoot: process.cwd(),
      home,
      apply: !parsed.dryRun,
      host: parsed.host,
    });
    for (const row of result.report) {
      process.stdout.write(row.line + "\n");
    }
    if (!result.ok) {
      process.stderr.write(result.error + "\n");
      return 1;
    }
    return 0;
  } catch (err) {
    process.stderr.write(errorText(err) + "\n");
    return 1;
  }
}
