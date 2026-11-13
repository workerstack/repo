#!/usr/bin/env bun
/** Allocate/slugify/write a one-off convo artifact under .repo/scratch/. */
import fs from "node:fs";
import path from "node:path";

import { REPO, SCRATCH, type RepoDir, repoPath } from "../repo-dirs.ts";
import { firstNonEmpty } from "./first-non-empty.ts";
import { DECIMAL, SERIAL_PREFIX_RE } from "./persist-doc.constants.ts";
import {
  type PersistResult,
  captured,
  compactCreatedStamp,
  createdAtOf,
  freeName,
  slugify,
  stripBom,
} from "./persist-doc.ts";
import { DEFAULT_EXT, EXT_MAX, EXT_RE, EXT_RE_OK, META_LINE_RE, NAME_RE } from "./persist-tmp.constants.ts";
import { resolveRoots } from "./workspace-root.ts";

const LINE_BREAK_RE = /\r?\n/;
const LEADING_DOT_RE = /^\./;

/** Whether `s` names no path: missing or empty. */
function isBlank(s: string | null | undefined): s is null | undefined | "" {
  return s == null || s === "";
}

export function isUnderDir(
  filePath: string | null | undefined,
  workspaceRoot: string | null | undefined,
  segments: string[],
): boolean {
  if (isBlank(filePath) || isBlank(workspaceRoot)) return false;
  const abs = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(workspaceRoot, filePath);
  const dir = path.resolve(workspaceRoot, ...segments);
  const rel = path.relative(dir, abs);

  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** True when `filePath` is inside `<workspaceRoot>/.repo/<dir>`. */
export function isUnderRepoDir(
  filePath: string | null | undefined,
  workspaceRoot: string | null | undefined,
  dir: RepoDir,
): boolean {
  return isUnderDir(filePath, workspaceRoot, [REPO, dir]);
}

export function isUnderTmp(filePath: string | null | undefined, workspaceRoot: string | null | undefined): boolean {
  if (isBlank(filePath) || isBlank(workspaceRoot)) return false;
  const abs = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(workspaceRoot, filePath);
  const root = repoPath(workspaceRoot, SCRATCH);

  return path.dirname(abs) === root;
}

/** Which persist owns a Write to `absPath`, given the scratch root; null for none. */
export function persistOwner(
  absPath: string,
  root: string,
): "plans" | "plans-fast" | "roadmaps" | "handoffs" | "implementations" | "tmp" | null {
  if (isUnderRepoDir(absPath, root, "plans")) return "plans";

  if (isUnderRepoDir(absPath, root, "plans-fast")) return "plans-fast";

  if (isUnderRepoDir(absPath, root, "roadmaps")) return "roadmaps";

  if (isUnderRepoDir(absPath, root, "handoffs")) return "handoffs";

  if (isUnderRepoDir(absPath, root, "implementations")) return "implementations";

  if (isUnderTmp(absPath, root)) return "tmp";

  return null;
}

/** `{serial}-{slug}-{YYYYMMDDTHHMMSSZ}.{ext}`; stamp required. */
export const FILENAME_RE: RegExp = /^[1-9][0-9]*-[a-z0-9]+(-[a-z0-9]+)*-\d{8}T\d{6}Z\.[a-z0-9]+$/;

export function extractTmpName(content: string): string {
  const m = content.match(NAME_RE);

  return m === null ? "" : String(m[1]).trim();
}

export function extractTmpExt(content: string): string {
  const m = content.match(EXT_RE);

  return m === null ? "" : String(m[1]).trim();
}

export function stripTmpMeta(content: string): string {
  return stripBom(content)
    .split(LINE_BREAK_RE)
    .filter((line) => !META_LINE_RE.test(line))
    .join("\n");
}

export function normalizeTmpExt(raw: string): string {
  const e = raw.trim().toLowerCase().replace(LEADING_DOT_RE, "");

  return EXT_RE_OK.test(e) && e.length <= EXT_MAX ? e : "";
}

/** One more than the highest serial among the files in `dir`. */
function nextTmpSerial(dir: string): number {
  const serials = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((ent) => ent.isFile())
    .map((ent) => SERIAL_PREFIX_RE.exec(ent.name))
    .filter((m) => m !== null)
    .map((m) => parseInt(captured(m, 1), DECIMAL));

  return Math.max(1, ...serials.map((n) => n + 1));
}

export type PersistTmpOptions = {
  workspaceRoot?: string;
  content?: string;
  created?: string;
};

export type PersistTmpResult = PersistResult<{
  path: string;
  serial: number;
  slug: string;
  ext: string;
  content: string;
  filename: string;
}>;

type Parsed = { error: string; name?: undefined } | { error?: undefined; name: string; ext: string; body: string };

/** The name, extension and body a tmp save carries, or why it is refused. */
function parseTmp(raw: string): Parsed {
  if (raw.includes("\0")) return { error: "binary" };
  const name = extractTmpName(raw);

  if (name === "") return { error: "missing TMP_NAME" };
  const extRaw = extractTmpExt(raw);
  const ext = extRaw === "" ? DEFAULT_EXT : normalizeTmpExt(extRaw);

  return ext === "" ? { error: "ext" } : { body: stripTmpMeta(raw), ext, name };
}

export function persistTmp({ workspaceRoot, content, created }: PersistTmpOptions = {}): PersistTmpResult {
  const ws = firstNonEmpty(workspaceRoot) ?? resolveRoots().root;
  const parsed = parseTmp(content ?? "");

  if (parsed.error !== undefined) return { error: parsed.error, ok: false };
  const { name, ext, body } = parsed;
  const slug = slugify(name);
  const dir = repoPath(ws, SCRATCH);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = compactCreatedStamp(createdAtOf(created));
  const free = freeName(dir, { ext, first: nextTmpSerial(dir), slug, stamp });

  if (free === undefined) return { error: "serial collision", ok: false };
  const { serial, filename, dest } = free;

  if (!FILENAME_RE.test(filename)) return { error: "filename", ok: false };
  fs.writeFileSync(dest, body);

  return {
    content: body,
    ext,
    filename,
    ok: true,
    path: `${REPO}/${SCRATCH}/${filename}`,
    serial,
    slug,
  };
}
