#!/usr/bin/env bun
/** Allocate/slugify/write a one-off convo artifact under .tmp/repo/. */
import fs from "node:fs";
import path from "node:path";
import { resolveRoots } from "./workspace-root.ts";
import { DATETIME_RE, type PersistResult, compactCreatedStamp, slugify, utcDateTime } from "./persist-plan.ts";

export const TMP_DIR = ".tmp/repo";
/** Top-level names under `.tmp/repo/` that repo owns; anything else at that level is a `/tmp` artifact or scratch. */
export const TMP_RESERVED_DIRS: Set<string> = new Set([
  "plans",
  "roadmaps",
  "handoffs",
  "implementations",
  "browser",
  "orchestrator-logs",
  "stash",
  "sessions",
  "listen",
  "speak",
]);
export function isUnderDir(
  filePath: string | null | undefined,
  workspaceRoot: string | null | undefined,
  segments: string[],
): boolean {
  if (!filePath || !workspaceRoot) return false;
  const abs = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(workspaceRoot, filePath);
  const dir = path.resolve(workspaceRoot, ...segments);
  const rel = path.relative(dir, abs);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function isUnderPlans(filePath: string | null | undefined, workspaceRoot: string | null | undefined): boolean {
  return isUnderDir(filePath, workspaceRoot, [".tmp", "repo", "plans"]);
}

export function isUnderRoadmaps(
  filePath: string | null | undefined,
  workspaceRoot: string | null | undefined,
): boolean {
  return isUnderDir(filePath, workspaceRoot, [".tmp", "repo", "roadmaps"]);
}

export function isUnderHandoffs(
  filePath: string | null | undefined,
  workspaceRoot: string | null | undefined,
): boolean {
  return isUnderDir(filePath, workspaceRoot, [".tmp", "repo", "handoffs"]);
}

export function isUnderImplementations(
  filePath: string | null | undefined,
  workspaceRoot: string | null | undefined,
): boolean {
  return isUnderDir(filePath, workspaceRoot, [".tmp", "repo", "implementations"]);
}

export function isUnderTmp(filePath: string | null | undefined, workspaceRoot: string | null | undefined): boolean {
  if (!filePath || !workspaceRoot) return false;
  const abs = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(workspaceRoot, filePath);
  const root = path.resolve(workspaceRoot, ".tmp", "repo");
  if (path.dirname(abs) !== root) return false;
  return !TMP_RESERVED_DIRS.has(path.basename(abs));
}

/** Which persist owns a Write to `absPath`, given the scratch root; null for none. */
export function persistOwner(
  absPath: string,
  root: string,
): "plans" | "roadmaps" | "handoffs" | "implementations" | "tmp" | null {
  if (isUnderPlans(absPath, root)) return "plans";
  if (isUnderRoadmaps(absPath, root)) return "roadmaps";
  if (isUnderHandoffs(absPath, root)) return "handoffs";
  if (isUnderImplementations(absPath, root)) return "implementations";
  if (isUnderTmp(absPath, root)) return "tmp";
  return null;
}

/** `{serial}-{slug}-{YYYYMMDDTHHMMSSZ}.{ext}`; stamp required. */
export const FILENAME_RE: RegExp = /^[1-9][0-9]*-[a-z0-9]+(-[a-z0-9]+)*-\d{8}T\d{6}Z\.[a-z0-9]+$/;
const META_LINE_RE = /^\s*TMP_(NAME|EXT):\s*.+\s*$/;
const NAME_RE = /^\s*TMP_NAME:\s*(.+?)\s*$/m;
const EXT_RE = /^\s*TMP_EXT:\s*(.+?)\s*$/m;

export function extractTmpName(content: unknown): string {
  const m = String(content).match(NAME_RE);
  return m ? String(m[1]).trim() : "";
}

export function extractTmpExt(content: unknown): string {
  const m = String(content).match(EXT_RE);
  return m ? String(m[1]).trim() : "";
}

export function stripTmpMeta(content: unknown): string {
  return String(content)
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => !META_LINE_RE.test(line))
    .join("\n");
}

export function normalizeTmpExt(raw: unknown): string {
  let e = String(raw || "")
    .trim()
    .toLowerCase();
  if (e.startsWith(".")) e = e.slice(1);
  if (!/^[a-z0-9]+$/.test(e) || e.length > 16) return "";
  return e;
}

function nextTmpSerial(dir: string) {
  let next = 1;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    const m = ent.name.match(/^([0-9]+)-/);
    if (!m) continue;
    const n = parseInt(String(m[1]), 10);
    next = Math.max(next, n + 1);
  }
  return next;
}

export interface PersistTmpOptions {
  workspaceRoot?: string;
  content?: unknown;
  created?: string;
}

export type PersistTmpResult = PersistResult<{
  path: string;
  serial: number;
  slug: string;
  ext: string;
  content: string;
  filename: string;
}>;

export function persistTmp({ workspaceRoot, content, created }: PersistTmpOptions = {}): PersistTmpResult {
  const ws = workspaceRoot || resolveRoots().root;
  const raw = String(content || "");
  if (raw.includes("\0")) return { ok: false, error: "binary" };
  const name = extractTmpName(raw);
  if (!name) return { ok: false, error: "missing TMP_NAME" };
  const extRaw = extractTmpExt(raw);
  const ext = extRaw ? normalizeTmpExt(extRaw) : "md";
  if (!ext) return { ok: false, error: "ext" };
  const slug = slugify(name);
  const body = stripTmpMeta(raw);
  const dir = path.join(ws, TMP_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const createdAt = created && DATETIME_RE.test(created) ? created : utcDateTime();
  const stamp = compactCreatedStamp(createdAt);
  let serial = nextTmpSerial(dir);
  let filename = `${serial}-${slug}-${stamp}.${ext}`;
  let dest = path.join(dir, filename);
  let tries = 0;
  while (fs.existsSync(dest) && tries < 5) {
    serial += 1;
    filename = `${serial}-${slug}-${stamp}.${ext}`;
    dest = path.join(dir, filename);
    tries += 1;
  }
  if (fs.existsSync(dest)) return { ok: false, error: "serial collision" };
  if (!FILENAME_RE.test(filename)) return { ok: false, error: "filename" };
  fs.writeFileSync(dest, body);
  return {
    ok: true,
    path: `${TMP_DIR}/${filename}`,
    serial,
    slug,
    ext,
    content: body,
    filename,
  };
}
