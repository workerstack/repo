/** Sentinel merge for AGENTS.md. Copied into consumers. */
import fs from "node:fs";
import path from "node:path";

export const GUARDED_ROOT_FILES: string[] = ["AGENTS.md"];
export const SENTINEL_BEGIN = "<!-- repo:begin -->";
export const SENTINEL_END = "<!-- repo:end -->";
export const MAX_GUARDED_MARKDOWN_BYTES = 2 * 1024 * 1024;
const MANAGED_REGION_RE =
  /(?:^|(?<=\n)|(?<=\r\n))[ \t]*<!-- repo:begin -->[ \t]*\r?\n?[\s\S]*?(?:^|(?<=\n)|(?<=\r\n))[ \t]*<!-- repo:end -->[ \t]*\r?\n?/g;
const MANAGED_INTERIOR_RE =
  /(?:^|(?<=\n)|(?<=\r\n))[ \t]*<!-- repo:begin -->[ \t]*\r?\n?([\s\S]*?)(?:^|(?<=\n)|(?<=\r\n))[ \t]*<!-- repo:end -->/g;
const ORPHAN_END_RE = /(?:^|\r?\n)[ \t]*<!-- repo:end -->[ \t]*(?=\r?\n|$)|<!-- repo:end -->/g;
const BEGIN_LINE_RE = /^[ \t]*<!-- repo:begin -->[ \t]*$/;
const END_LINE_RE = /^[ \t]*<!-- repo:end -->[ \t]*$/;

type UnsafeReason = "huge" | "binary";

function detectNewline(text: unknown): string {
  return String(text).includes("\r\n") ? "\r\n" : "\n";
}

function toNewline(text: unknown, nl: string): string {
  return String(text).replace(/\r\n/g, "\n").replace(/\n/g, nl);
}

function trimTrailingNewlines(text: unknown): string {
  return String(text).replace(/(?:\r?\n)+$/, "");
}

function trimLeadingBlankLines(text: unknown): string {
  return String(text).replace(/^(?:[ \t]*\r?\n)+/, "");
}

function normEq(a: unknown, b: unknown): boolean {
  return (
    trimTrailingNewlines(String(a).replace(/\r\n/g, "\n")) ===
    trimTrailingNewlines(String(b).replace(/\r\n/g, "\n"))
  );
}

function cloneRe(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags);
}

function inspectGuardedBuffer(buf: Buffer): UnsafeReason | null {
  if (buf.length > MAX_GUARDED_MARKDOWN_BYTES) return "huge";
  if (buf.includes(0)) return "binary";
  return null;
}

export function extractUserMarkdown(text: unknown): string {
  let user = String(text).replace(cloneRe(MANAGED_REGION_RE), "");
  const i = user.indexOf(SENTINEL_BEGIN);
  if (i >= 0) user = user.slice(0, i);
  user = user.replace(cloneRe(ORPHAN_END_RE), "");
  return userRemainderIsBlank(user) ? "" : user;
}

function unwrapStackedMarkers(text: unknown): string {
  const lines = String(text).split(/\r?\n/);
  let start = 0;
  let end = lines.length;
  // start < end <= lines.length, so lines[start] exists.
  while (start < end && (BEGIN_LINE_RE.test(lines[start]!) || !lines[start]!.trim())) start++;
  while (end > start && lines[end - 1] === "") end--;
  // end > start >= 0, so lines[end - 1] exists.
  while (end > start && END_LINE_RE.test(lines[end - 1]!)) {
    end--;
    while (end > start && lines[end - 1] === "") end--;
  }
  return lines.slice(start, end).join("\n");
}

export function extractManagedBody(text: unknown): string | null {
  const src = String(text);
  const parts: string[] = [];
  const re = cloneRe(MANAGED_INTERIOR_RE);
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    parts.push(trimTrailingNewlines(unwrapStackedMarkers(m[1] ?? "")));
  }
  if (parts.length) return parts.join("\n");
  const i = src.indexOf(SENTINEL_BEGIN);
  if (i >= 0) {
    return trimTrailingNewlines(
      unwrapStackedMarkers(src.slice(i + SENTINEL_BEGIN.length).replace(/^[ \t]*\r?\n/, "")),
    );
  }
  if (!src.includes(SENTINEL_END)) return null;
  return trimTrailingNewlines(unwrapStackedMarkers(src));
}

function userRemainderIsBlank(user: unknown): boolean {
  return String(user).replace(/\r\n/g, "\n").replace(/\n/g, "") === "";
}

/** Blank lines around each sentinel: the markdown formatter fixed point (prettier, remark, mdformat). */
export function composeGuardedMarkdown(managedBody: string, userRemainder: unknown, nl = "\n"): string {
  const raw = extractManagedBody(managedBody) ?? managedBody;
  const body = toNewline(trimTrailingNewlines(trimLeadingBlankLines(raw)), nl);
  const inner = body ? `${nl}${body}${nl}${nl}` : nl;
  const block = `${SENTINEL_BEGIN}${nl}${inner}${SENTINEL_END}${nl}`;
  const user = extractUserMarkdown(userRemainder == null ? "" : String(userRemainder));
  if (!user || userRemainderIsBlank(user)) return block;
  return `${block}${nl}${toNewline(trimLeadingBlankLines(user), nl)}`;
}

export function mergeGuardedContent(existingText: unknown, managedBody: string): string {
  const existing = existingText == null ? "" : String(existingText);
  const nl =
    existing.includes("\r\n") || String(managedBody).includes("\r\n")
      ? detectNewline(existing || managedBody)
      : "\n";
  if (!existing) return composeGuardedMarkdown(managedBody, "", nl);
  const hadSentinel = existing.includes(SENTINEL_BEGIN) && existing.includes(SENTINEL_END);
  const user = extractUserMarkdown(existing);
  if (!hadSentinel && normEq(existing, managedBody)) {
    return composeGuardedMarkdown(managedBody, "", nl);
  }
  return composeGuardedMarkdown(managedBody, user, nl);
}

/** `##` blocks in `existing` whose titles are not in `incoming`. */
export function extraH2Sections(existing: unknown, incoming: unknown): string {
  const incomingTitles = new Set(
    [...String(incoming ?? "").matchAll(/^## (.+)$/gm)].map((m) => (m[1] ?? "").trim()),
  );
  const text = String(existing ?? "").replace(/\r\n/g, "\n");
  const matches = [...text.matchAll(/^## /gm)];
  if (!matches.length) return "";
  const chunks: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    // matchAll results always carry an index, and i is within matches.
    const start = matches[i]!.index!;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : text.length;
    const block = text.slice(start, end).replace(/(?:\n)+$/, "");
    const title = block.match(/^## (.+)$/m)?.[1]?.trim();
    if (title && !incomingTitles.has(title)) chunks.push(block);
  }
  return chunks.join("\n\n");
}

/** Repo body plus consumer-only `##` sections. No sentinels (INDEX inlines law.md). */
export function mergeReferenceMarkdown(existing: unknown, incoming: unknown): string {
  const src = String(incoming ?? "");
  const extras = extraH2Sections(existing ?? "", src);
  const base = src.replace(/(?:\r?\n)+$/, "");
  if (!extras.trim()) return `${base}\n`;
  return `${base}\n\n${extras.replace(/(?:\n)+$/, "")}\n`;
}

export function writeMergedGuardedFile(destPath: string, managedBody: string): "aborted-unsafe" | undefined {
  if (!fs.existsSync(destPath)) {
    fs.writeFileSync(destPath, mergeGuardedContent("", managedBody));
    return undefined;
  }
  const buf = fs.readFileSync(destPath);
  if (inspectGuardedBuffer(buf)) return "aborted-unsafe";
  fs.writeFileSync(destPath, mergeGuardedContent(buf.toString("utf8"), managedBody));
  return undefined;
}

export function guardedMarkdownDrift(destPath: string, managedBody: string): boolean {
  if (!fs.existsSync(destPath)) return true;
  const buf = fs.readFileSync(destPath);
  if (inspectGuardedBuffer(buf)) return true;
  const text = buf.toString("utf8");
  const interior = extractManagedBody(text);
  if (interior == null) return !normEq(text, managedBody);
  return !normEq(interior, managedBody);
}

/**
 * What `snapshotGuardedRoots` remembers of one guarded root file: its text and the user part, or the raw bytes
 * when the file is unsafe to rewrite (binary or huge).
 */
type GuardedRootRecord = { unsafe: UnsafeReason; rawBuf: Buffer; } | { unsafe?: undefined; raw: string; user: string; };

export type GuardedRootSnapshot = Record<string, GuardedRootRecord>;

/**
 * @param root
 * @returns
 */
export function snapshotGuardedRoots(root: string): GuardedRootSnapshot {
  const snap: GuardedRootSnapshot = {};
  for (const file of GUARDED_ROOT_FILES) {
    const p = path.join(root, file);
    if (!fs.existsSync(p)) continue;
    const buf = fs.readFileSync(p);
    const unsafe = inspectGuardedBuffer(buf);
    if (unsafe) {
      snap[file] = { unsafe, rawBuf: buf };
      continue;
    }
    const raw = buf.toString("utf8");
    snap[file] = { raw, user: extractUserMarkdown(raw) };
  }
  return snap;
}

/**
 * @param root
 * @param snap
 */
export function remergeGuardedRoots(root: string, snap: GuardedRootSnapshot): void {
  for (const file of GUARDED_ROOT_FILES) {
    const p = path.join(root, file);
    const rec = snap[file];
    if (rec?.unsafe) {
      fs.writeFileSync(p, rec.rawBuf);
      continue;
    }
    if (!fs.existsSync(p)) {
      if (rec?.raw != null) fs.writeFileSync(p, rec.raw);
      continue;
    }
    const buf = fs.readFileSync(p);
    if (inspectGuardedBuffer(buf)) {
      if (rec?.raw != null) fs.writeFileSync(p, rec.raw);
      continue;
    }
    const current = buf.toString("utf8");
    if (rec && current === rec.raw) continue;
    const managedBody = extractManagedBody(current) ?? current;
    const nl = detectNewline((rec && rec.raw) || current);
    let user = rec ? rec.user : extractUserMarkdown(current);
    if (rec && !rec.raw.includes(SENTINEL_BEGIN) && normEq(rec.raw, managedBody)) user = "";
    if (!rec && extractManagedBody(current) == null && normEq(current, managedBody)) user = "";
    fs.writeFileSync(p, composeGuardedMarkdown(managedBody, user, nl));
  }
}

/**
 * Re-merge one guarded root file after a generator rewrote it; updates `snap` in place.
 * @param root
 * @param file
 * @param snap
 */
export function healGuardedRootFile(root: string, file: string, snap: GuardedRootSnapshot): void {
  if (!GUARDED_ROOT_FILES.includes(file)) return;
  const p = path.join(root, file);
  const rec = snap[file];
  if (!fs.existsSync(p)) return;
  if (rec?.unsafe) {
    fs.writeFileSync(p, rec.rawBuf);
    return;
  }
  const buf = fs.readFileSync(p);
  if (inspectGuardedBuffer(buf)) {
    if (rec?.raw != null) fs.writeFileSync(p, rec.raw);
    return;
  }
  const current = buf.toString("utf8");
  const interior = extractManagedBody(current);
  if (interior != null) {
    snap[file] = { raw: current, user: extractUserMarkdown(current) };
    return;
  }
  if (rec && current === rec.raw) return;
  const managedBody = current;
  const nl = detectNewline((rec && rec.raw) || current);
  let user = rec ? rec.user : extractUserMarkdown(current);
  if (rec && !rec.raw.includes(SENTINEL_BEGIN) && normEq(rec.raw, managedBody)) user = "";
  if (!rec && normEq(current, managedBody)) user = "";
  const out = composeGuardedMarkdown(managedBody, user, nl);
  fs.writeFileSync(p, out);
  snap[file] = { raw: out, user };
}

export function withGuardedCheckInteriors<T>(root: string, fn: () => T): T {
  const snap = snapshotGuardedRoots(root);
  try {
    for (const file of GUARDED_ROOT_FILES) {
      const rec = snap[file];
      if (!rec || rec.unsafe) continue;
      const body = extractManagedBody(rec.raw);
      if (body == null) continue;
      const nl = detectNewline(rec.raw);
      fs.writeFileSync(path.join(root, file), `${toNewline(trimTrailingNewlines(body), nl)}${nl}`);
    }
    return fn();
  } finally {
    for (const file of GUARDED_ROOT_FILES) {
      const rec = snap[file];
      if (!rec) continue;
      if (rec.unsafe) fs.writeFileSync(path.join(root, file), rec.rawBuf);
      else fs.writeFileSync(path.join(root, file), rec.raw);
    }
  }
}
