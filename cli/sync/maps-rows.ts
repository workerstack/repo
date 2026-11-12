import fs from "node:fs";
import path from "node:path";

import { group } from "../docs-fences.ts";
import { isRecord, isString, type Json, type JsonObject } from "../json.ts";
import { splitFrontmatter } from "../scripts/emit-agent-shell-tools.ts";
import { STOCK_SKILLS_REL } from "../scripts/skill-conflicts.ts";
import { parseDoc } from "./agents/frontmatter.ts";
import { DESC_MAX, HUGE_BYTES, REFS_REL, SKIP_REF_NAMES, STOCK_REFS_PREFIX } from "./maps.constants.ts";
import { stockRoot } from "./stock.ts";

const WHITESPACE_RUN = /\s+/g;
const H1_LINE = /^#\s+(.+?)\s*$/m;
const H1_TRAILING_HASHES = /\s+#+\s*$/;
const LINE_BREAK = /\r?\n/;
const H1_PREFIX = /^#\s+/;

/** A markdown file's frontmatter mapping and the body after it. */
type ParsedMarkdown = { parsed: JsonObject; body: string };

/** The frontmatter mapping of `src`; `{}` for a block `parseDoc` refuses, which validate-formats reports. */
function frontmatterOf(rel: string, src: string): JsonObject {
  try {
    return parseDoc(rel, src).data;
  } catch {
    return {};
  }
}

/**
 * The frontmatter and body of the markdown file at `rel`; no frontmatter reads as `{}` and keeps the whole text as
 * the body, and a block that does not parse reads as `{}` and keeps the body after it.
 */
function parseMarkdown(rel: string, src: string): ParsedMarkdown {
  const split = splitFrontmatter(src);

  if (!split.ok) return { body: src, parsed: {} };

  return { body: split.body, parsed: frontmatterOf(rel, src) };
}

/** A reference file: its path and its path relative to the root. */
type RefFile = {
  abs: string;
  rel: string;
};

function oneLine(s: string): string {
  const t = s.replaceAll(WHITESPACE_RUN, " ").trim();

  if (t.length <= DESC_MAX) return t;

  return `${t.slice(0, Math.max(0, DESC_MAX - 1)).trimEnd()}…`;
}

function cell(s: string): string {
  return oneLine(s).replaceAll("|", "\\|");
}

/** A list value's items as text, a non-empty string as its one item, anything else as none. */
function listText(v: Json | undefined): string[] {
  if (Array.isArray(v)) return v.map(String);

  return isString(v) && v !== "" ? [v] : [];
}

function mapRefs(parsed: JsonObject): string[] {
  const dotted = listText(parsed["map.refs"]);

  if (dotted.length > 0) return dotted;
  const m = parsed.map;

  return isRecord(m) ? listText(m.refs) : [];
}

function scalarText(v: Json | undefined): string {
  return isString(v) ? v : "";
}

function mapTask(parsed: JsonObject): string {
  const dotted = scalarText(parsed["map.task"]);

  if (dotted !== "") return dotted;
  const m = parsed.map;

  return isRecord(m) ? scalarText(m.task) : "";
}

function tagsOf(parsed: JsonObject): string[] {
  return listText(parsed.tags);
}

function firstH1(body: string): string {
  const m = H1_LINE.exec(body);

  return m === null ? "" : group(m, 1).replace(H1_TRAILING_HASHES, "").trim();
}

function firstSummary(body: string): string {
  let isPastH1 = false;

  for (const line of body.split(LINE_BREAK)) {
    const t = line.trim();

    if (!isPastH1) {
      if (H1_PREFIX.test(t)) isPastH1 = true;
      continue;
    }

    if (t === "") continue;

    if (t.startsWith("#") || t.startsWith("```") || t.startsWith("<!--") || t.startsWith("---")) continue;

    return oneLine(t);
  }

  return "";
}

/** The `.md` files under `dir`, dot entries and skipped names left out, appended to `acc` with `relBase` paths. */
export function walkRefMd(dir: string, relBase: string, acc: RefFile[]): RefFile[] {
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }

  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    const abs = path.join(dir, ent.name);
    const rel = `${relBase}/${ent.name}`;

    if (ent.isDirectory()) walkRefMd(abs, rel, acc);
    else if (ent.isFile() && ent.name.endsWith(".md") && !SKIP_REF_NAMES.has(ent.name)) acc.push({ abs, rel });
  }

  return acc;
}

function isFile(abs: string): boolean {
  try {
    return fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

/** The row of the skill in `dir` under `root`'s skills: its name, origin, description, task, commandPath and refs. */
export function skillRow(root: string, dir: string): string {
  const raw = fs.readFileSync(path.join(root, STOCK_SKILLS_REL, dir, "SKILL.md"), "utf8");
  const { parsed, body } = parseMarkdown(`${STOCK_SKILLS_REL}/${dir}/SKILL.md`, raw);
  const named = scalarText(parsed.name);
  const name = named === "" ? dir : named;
  const described = scalarText(parsed.description);
  const descSrc = described === "" ? firstSummary(body) : described;
  const origin = isFile(path.join(stockRoot(root), STOCK_SKILLS_REL, dir, "SKILL.md")) ? "repo" : "local";
  const cells = [name, origin, descSrc, mapTask(parsed), scalarText(parsed.commandPath), mapRefs(parsed).join(", ")];

  return `| ${cells.map(cell).join(" | ")} |`;
}

/** The row of a reference file: its shown path, title, tags and summary; a huge or binary file gets its name only. */
export function refRow(file: RefFile): string {
  const shown = `${STOCK_REFS_PREFIX}${file.rel.slice(REFS_REL.length + 1)}`;
  const fallbackTitle = path.basename(file.rel, ".md");
  const bare = `| ${cell(shown)} | ${cell(fallbackTitle)} |  |  |`;

  if (fs.statSync(file.abs).size > HUGE_BYTES) return bare;
  const raw = fs.readFileSync(file.abs, "utf8");

  if (raw.includes("\0")) return bare;
  const { parsed, body } = parseMarkdown(file.rel, raw);
  const heading = firstH1(body);
  const title = heading === "" ? fallbackTitle : heading;
  const tags = tagsOf(parsed).join(", ");
  const summary = firstSummary(body);

  return `| ${cell(shown)} | ${cell(title)} | ${cell(tags)} | ${cell(summary)} |`;
}

/** A markdown table of `rows` under `header`. */
export function table(header: string[], rows: string[]): string {
  return [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows].join("\n");
}
