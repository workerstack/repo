import fs from "node:fs";
import path from "node:path";
import { splitFrontmatter } from "../scripts/emit-agent-shell-tools.ts";
import { STOCK_SKILLS_REL, listSkillDirNames } from "../scripts/skill-conflicts.ts";
import { lines } from "../scripts/managed-text.ts";
import { stockRoot } from "./stock.ts";

/** A frontmatter value as the small YAML reader below produces it. */
type YamlValue = string | string[] | YamlObject;
interface YamlObject {
  [key: string]: YamlValue;
}

interface RefFile {
  abs: string;
  rel: string;
}

interface SkillFields {
  name: string;
  origin: string;
  descSrc: YamlValue | string;
  commandPath: string;
  refs: string;
  task: string;
}

const isYamlObject = (v: unknown): v is YamlObject => typeof v === "object" && v !== null && !Array.isArray(v);

/** How the stock package's reference files are named in the refs table. */
const STOCK_REFS_PREFIX = "node_modules/@workerstack/repo/references/";
const REFS_REL = "references";
const DESC_MAX = 120;
const HUGE_BYTES = 512 * 1024;
const SKIP_REF_NAMES = new Set(["INDEX.md"]);

function unquoteYaml(raw: unknown): string {
  const s = String(raw).trim();
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    try {
      return String(JSON.parse(s));
    } catch {
      return s.slice(1, -1);
    }
  }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

function parseFlowSeq(s: unknown): string[] | null {
  const t = String(s).trim();
  if (!t.startsWith("[") || !t.endsWith("]")) return null;
  const inner = t.slice(1, -1).trim();
  if (!inner) return [];
  return inner
    .split(",")
    .map((x) => unquoteYaml(x.trim()))
    .filter((x) => x !== "");
}

function indentOf(line: unknown): number {
  // The pattern matches the empty string, so a match always exists.
  return String(line).match(/^[ \t]*/)![0].length;
}

function parseYamlDoc(fm: unknown): YamlObject {
  const lines = String(fm).split(/\r?\n/);
  // Every call below is guarded by `i < lines.length`, so the fallback never shows.
  const at = (n: number): string => lines[n]!;
  let i = 0;
  function parseBlock(baseIndent: number): YamlObject {
    const obj: YamlObject = {};
    while (i < lines.length) {
      const line = at(i);
      if (!line.trim() || /^\s*#/.test(line)) {
        i += 1;
        continue;
      }
      const ind = indentOf(line);
      if (ind < baseIndent) break;
      if (baseIndent > 0 && ind > baseIndent) break;
      const trimmed = line.trim();
      const km = trimmed.match(/^([^:#\s][^:]*):\s*(.*?)\s*$/);
      if (!km) {
        i += 1;
        continue;
      }
      // Both groups are unconditional in the pattern, so a match has them.
      const key = km[1]!.trim();
      const val = km[2]!;
      i += 1;
      if (val === ">" || val === "|") {
        const parts: string[] = [];
        while (i < lines.length) {
          const n = at(i);
          if (!n.trim()) {
            parts.push("");
            i += 1;
            continue;
          }
          if (indentOf(n) <= ind) break;
          parts.push(n.trim());
          i += 1;
        }
        obj[key] = parts.filter(Boolean).join(" ");
        continue;
      }
      if (val === "") {
        if (i < lines.length && indentOf(at(i)) > ind) {
          const next = at(i).trim();
          if (next.startsWith("- ")) {
            const arr: string[] = [];
            while (i < lines.length && indentOf(at(i)) > ind && at(i).trim().startsWith("- ")) {
              arr.push(unquoteYaml(at(i).trim().replace(/^- /, "")));
              i += 1;
            }
            obj[key] = arr;
          } else {
            obj[key] = parseBlock(indentOf(at(i)));
          }
        } else {
          obj[key] = {};
        }
        continue;
      }
      const seq = parseFlowSeq(val);
      obj[key] = seq != null ? seq : unquoteYaml(val);
    }
    return obj;
  }
  return parseBlock(0);
}

function oneLine(s: unknown, max: number = DESC_MAX): string {
  const t = String(s).replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
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
  // Group 1 is unconditional in the pattern, so a match has it.
  return m ? m[1]!.replace(/\s+#+\s*$/, "").trim() : "";
}

function firstSummary(body: string): string {
  const lines = body.split(/\r?\n/);
  let pastH1 = false;
  for (const line of lines) {
    const t = line.trim();
    if (!pastH1) {
      if (/^#\s+/.test(t)) pastH1 = true;
      continue;
    }
    if (!t) continue;
    if (/^#/.test(t) || /^```/.test(t) || /^<!--/.test(t) || /^---/.test(t)) continue;
    return oneLine(t);
  }
  return "";
}

function parseMarkdown(src: string): { parsed: YamlObject; body: string } {
  const split = splitFrontmatter(src);
  if (!split.ok) return { parsed: {}, body: src };
  return { parsed: parseYamlDoc(split.fm), body: split.body };
}

function walkRefMd(dir: string, relBase: string, acc: RefFile[]): RefFile[] {
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
    if (ent.isDirectory()) {
      walkRefMd(abs, rel, acc);
      continue;
    }
    if (!ent.isFile() || !ent.name.endsWith(".md")) continue;
    if (SKIP_REF_NAMES.has(ent.name)) continue;
    acc.push({ abs, rel });
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

function skillFields(root: string, dir: string): SkillFields {
  const raw = fs.readFileSync(path.join(root, STOCK_SKILLS_REL, dir, "SKILL.md"), "utf8");
  const { parsed, body } = parseMarkdown(raw);
  const name = parsed.name != null && parsed.name !== "" ? String(parsed.name) : dir;
  const descSrc = parsed.description != null && parsed.description !== "" ? parsed.description : firstSummary(body);
  const commandPath = parsed.commandPath != null ? String(parsed.commandPath) : "";
  const refs = mapRefs(parsed).join(", ");
  const task = mapTask(parsed);
  const origin = isFile(path.join(stockRoot(root), STOCK_SKILLS_REL, dir, "SKILL.md")) ? "repo" : "local";
  return { name, origin, descSrc, commandPath, refs, task };
}

function skillRowFromFields(f: SkillFields): string {
  return `| ${cell(f.name)} | ${cell(f.origin)} | ${cell(f.descSrc)} | ${cell(f.task)} | ${cell(f.commandPath)} | ${cell(f.refs)} |`;
}

function refRow(file: RefFile): string {
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

function table(header: string[], rows: string[]): string {
  return [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows].join("\n");
}

/**
 * The bodies of the `repo:skills` and `repo:refs` sections of references/INDEX.md, from one scan of the skills
 * and references under `root`. Only this package keeps them; the hand-written text of the index is never touched.
 */
export function mapSections(root: string): { skills: string; refs: string } {
  const skills = listSkillDirNames(path.join(root, STOCK_SKILLS_REL)).map((dir) =>
    skillRowFromFields(skillFields(root, dir)),
  );
  const refs = walkRefMd(path.join(root, REFS_REL), REFS_REL, [])
    .sort((a, b) => a.rel.localeCompare(b.rel))
    .map(refRow);
  return {
    skills: table(["name", "origin", "description", "task", "commandPath", "refs"], skills),
    refs: table(["path", "title", "tags", "summary"], refs),
  };
}

/** Where `repo sync` keeps the generated sections that `repo doctor` reads back. */
export const INDEX_REL = "references/INDEX.md";

/** The lines between `<!-- repo:<name> -->` and `<!-- /repo:<name> -->`, or null when the pair is missing. */
export function sectionBody(text: string, name: string): string[] | null {
  const all = lines(text);
  const start = all.findIndex((l) => l.trimEnd() === `<!-- repo:${name} -->`);
  if (start === -1) return null;
  const stop = all.findIndex((l, at) => at > start && l.trimEnd() === `<!-- /repo:${name} -->`);
  return stop === -1 ? null : all.slice(start + 1, stop).map((l) => l.trimEnd());
}
