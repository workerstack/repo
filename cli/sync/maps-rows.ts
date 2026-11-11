import fs from "node:fs";
import path from "node:path";

import { STOCK_SKILLS_REL } from "../scripts/skill-conflicts.ts";
import { parseFlowSeq, parseMarkdown, type YamlObject } from "./maps-yaml.ts";
import { DESC_MAX, HUGE_BYTES, REFS_REL, SKIP_REF_NAMES, STOCK_REFS_PREFIX } from "./maps.constants.ts";
import { stockRoot } from "./stock.ts";

const isYamlObject = (v: unknown): v is YamlObject => typeof v === "object" && v !== null && !Array.isArray(v);

/** A reference file: its path and its path relative to the root. */
interface RefFile {
  abs: string;
  rel: string;
}

function oneLine(s: unknown): string {
  const t = String(s).replace(/\s+/g, " ").trim();
  if (t.length <= DESC_MAX) return t;
  return `${t.slice(0, Math.max(0, DESC_MAX - 1)).trimEnd()}…`;
}

function cell(s: unknown): string {
  return oneLine(s).replace(/\|/g, "\\|");
}

function mapRefs(parsed: YamlObject): string[] {
  const dotted = parsed["map.refs"];
  if (Array.isArray(dotted)) return dotted.map(String);
  if (typeof dotted === "string" && dotted) return [dotted];
  const m = parsed.map;
  if (isYamlObject(m) && Array.isArray(m.refs)) return m.refs.map(String);
  if (isYamlObject(m) && typeof m.refs === "string" && m.refs) return [m.refs];
  return [];
}

function scalarTask(v: unknown): string {
  return typeof v === "string" && v !== "" ? v : "";
}

function mapTask(parsed: YamlObject): string {
  const dotted = scalarTask(parsed["map.task"]);
  if (dotted) return dotted;
  const m = parsed.map;
  if (isYamlObject(m)) return scalarTask(m.task);
  return "";
}

function tagsOf(parsed: YamlObject): string[] {
  if (Array.isArray(parsed.tags)) return parsed.tags.map(String);
  if (typeof parsed.tags === "string" && parsed.tags) {
    const seq = parseFlowSeq(parsed.tags);
    if (seq) return seq.map(String);
    return [parsed.tags];
  }
  return [];
}

function firstH1(body: string): string {
  const m = body.match(/^#\s+(.+?)\s*$/m);
  return m ? (m[1] /* group 1 is unconditional in the pattern */ as string).replace(/\s+#+\s*$/, "").trim() : "";
}

function firstSummary(body: string): string {
  let pastH1 = false;
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!pastH1) {
      if (/^#\s+/.test(t)) pastH1 = true;
      continue;
    }
    if (!t) continue;
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
  const { parsed, body } = parseMarkdown(raw);
  const name = parsed.name != null && parsed.name !== "" ? String(parsed.name) : dir;
  const descSrc = parsed.description != null && parsed.description !== "" ? parsed.description : firstSummary(body);
  const commandPath = parsed.commandPath != null ? String(parsed.commandPath) : "";
  const origin = isFile(path.join(stockRoot(root), STOCK_SKILLS_REL, dir, "SKILL.md")) ? "repo" : "local";
  const cells = [name, origin, descSrc, mapTask(parsed), commandPath, mapRefs(parsed).join(", ")];
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
  const { parsed, body } = parseMarkdown(raw);
  const title = firstH1(body) || fallbackTitle;
  const tags = tagsOf(parsed).join(", ");
  const summary = firstSummary(body);
  return `| ${cell(shown)} | ${cell(title)} | ${cell(tags)} | ${cell(summary)} |`;
}

/** A markdown table of `rows` under `header`. */
export function table(header: string[], rows: string[]): string {
  return [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows].join("\n");
}
