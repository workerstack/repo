/** The steps every doc save shares: where it writes, what it was sent, its refusal, its free name and its source. */
import fs from "node:fs";
import path from "node:path";

import { firstNonEmpty } from "./first-non-empty.ts";
import { FM_OPEN, SERIAL_PREFIX_RE, SOURCE_MAX } from "./persist-doc.constants.ts";
import {
  captured,
  compactCreatedStamp,
  createdAtOf,
  freeName,
  nextSerial,
  slugFromFilename,
  stripBom,
  type PersistResult,
} from "./persist-doc.ts";
import { withSavedFrontmatter } from "./persist-plan-head.ts";
import { unclosedFenceErrors } from "./persist-sections.ts";
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

/** A saved plan or fast plan: where it is, its serial and slug, and the text the host writes. */
export type PlanResult = PersistResult<{
  path: string;
  serial: number;
  slug: string;
  content: string;
  filename: string;
}>;

/**
 * Rewrite of a saved plan or fast plan: same file and serial. `validate` names the denials for the new text (it is
 * given the saved text too). Validates only: the host writes `content`, since a write here first makes Claude Code
 * refuse the Write as modified since read.
 */
export function prepareRewrite(
  input: Rewrite,
  validate: (filename: string, text: string, previous: string) => string[],
): PlanResult {
  const { raw, previous, filename, rel } = rewriteTarget(input);
  const text = stripBom(raw);
  const fence = unclosedFenceErrors(text);

  if (fence.length > 0) return refused(fence);
  const full = text.startsWith(FM_OPEN) ? text : withSavedFrontmatter(previous, text);
  const errors = validate(filename, full, previous);

  if (errors.length > 0) return refused(errors);

  return {
    content: full,
    filename,
    ok: true,
    path: rel,
    // validate accepted the filename, so the serial prefix is there
    serial: Number(SERIAL_PREFIX_RE.exec(filename)?.[1]),
    slug: slugFromFilename(filename),
  };
}

/** The serial and file a new plan is written to, with its creation time. */
export type Allocation = { createdAt: string; dest: string; filename: string; serial: number };

/** Next serial and the file a new plan is written to under `dir`, which is made when missing. */
export function allocate(dir: string, slug: string, created: string | undefined): Allocation {
  fs.mkdirSync(dir, { recursive: true });
  const createdAt = createdAtOf(created);
  const serial = nextSerial(dir);
  const filename = `${serial}-${slug}-${compactCreatedStamp(createdAt)}.md`;

  return { createdAt, dest: path.join(dir, filename), filename, serial };
}
