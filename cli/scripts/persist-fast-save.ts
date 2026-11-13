/** The save a fast plan and a fast roadmap share: name line, serial, frontmatter, validation, exclusive write. */
import fs from "node:fs";
import path from "node:path";

import { firstNonEmpty } from "./first-non-empty.ts";
import { createdLine, extractH1, injectFrontmatter, slugify, sourceLine, stripFrontmatter } from "./persist-doc.ts";
import { extractCommit, stripCommitLine } from "./persist-plan-head.ts";
import { type PlanResult, allocate, persistSource, refused, saveTarget } from "./persist-save.ts";
import { unclosedFenceErrors } from "./persist-sections.ts";

/** What one kind of fast doc is saved with. */
export type FastKind = {
  /** Directory under the workspace, such as `.repo/plans-fast`. */
  dir: string;
  /** The `FAST_..._NAME:` line, captured name in group 1. */
  nameRe: RegExp;
  /** Status a new doc starts with. */
  status: string;
  /** The section whose text is the source when nothing else names it, captured in group 1. */
  sourceRe: RegExp;
  /** Whether a `commit:` line is read from the text and kept. */
  commit: boolean;
  validate: (filename: string, text: string) => string[];
};

export type FastSaveInput = {
  workspaceRoot?: string;
  content?: string;
  source?: string;
  created?: string;
};

/** A name line above the first `## `, and the text without it and the blanks after it. */
function splitName(raw: string, nameRe: RegExp) {
  const lines = raw.split("\n");
  const end = lines.findIndex((l) => l.startsWith("## "));
  const at = lines.slice(0, end < 0 ? lines.length : end).findIndex((l) => nameRe.test(l));

  if (at < 0) return { name: "", rest: raw };
  const name = String(nameRe.exec(String(lines[at]))?.[1]);
  const after = lines.slice(at + 1);
  const blanks = after.findIndex((l) => l.trim() !== "");

  return {
    name,
    rest: [...lines.slice(0, at), ...after.slice(blanks < 0 ? after.length : blanks)].join("\n"),
  };
}

/** Saves a new fast doc: serial counted in its own directory only, frontmatter without reviews or strategy. */
export function saveFast(input: FastSaveInput, kind: FastKind): PlanResult {
  const { ws, raw } = saveTarget(input.workspaceRoot, input.content);
  const fence = unclosedFenceErrors(raw);

  if (fence.length > 0) return refused(fence);
  const { name, rest } = splitName(raw, kind.nameRe);
  const body = kind.commit ? stripCommitLine(rest) : rest;
  const slug = slugify(firstNonEmpty(name) ?? extractH1(stripFrontmatter(body)));
  const { createdAt, serial, filename, dest } = allocate(path.join(ws, kind.dir), slug, input.created);
  const commit = kind.commit ? extractCommit(raw) : undefined;

  const lines = [
    `serial: ${serial}`,
    `name: ${slug}`,
    `status: ${kind.status}`,
    createdLine(createdAt),
    sourceLine(persistSource([input.source, name], kind.sourceRe.exec(stripFrontmatter(body)), slug)),
    ...(commit === undefined ? [] : [`commit: ${commit}`]),
  ];

  const full = injectFrontmatter(lines, slug, stripFrontmatter(body));
  const errors = kind.validate(filename, full);

  if (errors.length > 0) return refused(errors);
  // `wx`: a name taken since the serial was read fails loudly instead of overwriting another doc.
  fs.writeFileSync(dest, full, { flag: "wx" });

  return {
    content: full,
    filename,
    ok: true,
    path: `${kind.dir}/${filename}`,
    serial,
    slug,
  };
}
