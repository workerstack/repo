/** The steps every doc save shares: where it writes, what it was sent, its refusal, its free name and its source. */
import fs from "node:fs";
import path from "node:path";

import { firstNonEmpty } from "./first-non-empty.ts";
import { SOURCE_MAX } from "./persist-doc.constants.ts";
import { captured, compactCreatedStamp, createdAtOf, freeName } from "./persist-doc.ts";
import { resolveRoots } from "./workspace-root.ts";

const SPACES_RE = /\s+/g;

/** A refused save: every reason, joined into `error`. */
export type Refusal = { ok: false; error: string; errors: string[] };

/** The workspace a save writes under and the text it was sent. */
export type SaveTarget = { ws: string; raw: string };

/** The workspace a save writes under (the repo root when none is sent) and the text it was sent. */
export function saveTarget(workspaceRoot: string | undefined, content: string | undefined): SaveTarget {
  return { raw: content ?? "", ws: firstNonEmpty(workspaceRoot) ?? resolveRoots().root };
}

/** A rewrite of a saved doc: where its workspace is, which file, and the text sent. */
export type Rewrite = { workspaceRoot?: string; filePath: string; content?: string };

/** What a rewrite works on: the text sent, the saved text, the file name and the workspace-relative path. */
export type RewriteTarget = { raw: string; previous: string; filename: string; rel: string };

/** What a rewrite works on: the text sent, the saved text, the file name and the workspace-relative path. */
export function rewriteTarget({ workspaceRoot, filePath, content }: Rewrite): RewriteTarget {
  const { ws, raw } = saveTarget(workspaceRoot, content);
  const abs = path.resolve(ws, filePath);
  const rel = path.relative(ws, abs).split(path.sep).join("/");

  return { filename: path.basename(abs), previous: fs.readFileSync(abs, "utf8"), raw, rel };
}

export function refused(errors: string[]): Refusal {
  return { error: errors.join("; "), errors, ok: false };
}

/** A save's creation stamp and the free name it was stamped into (undefined when none is free). */
export type StampedName = { createdAt: string; free: ReturnType<typeof freeName> };

/** `created` when it is a full UTC datetime (else now), and a free name in `dir` stamped with it. */
export function stampedName(
  dir: string,
  { first, slug, created }: { first: number; slug: string; created: string | undefined },
): StampedName {
  const createdAt = createdAtOf(created);
  const stamp = compactCreatedStamp(createdAt);

  return { createdAt, free: freeName(dir, { first, slug, stamp }) };
}

/**
 * The `source:` text: the first non-empty of `named`, else the section's capture squeezed to one line, else
 * `fallback`; cut to the limit.
 */
export function persistSource(
  named: (string | undefined)[],
  section: RegExpMatchArray | null,
  fallback: string,
): string {
  const squeezed = section === null ? fallback : captured(section, 1).trim().replaceAll(SPACES_RE, " ");

  return (firstNonEmpty(...named) ?? squeezed).slice(0, SOURCE_MAX);
}
