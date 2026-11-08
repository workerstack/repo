#!/usr/bin/env bun
/** Fill the `repo:skills` and `repo:refs` sections of references/INDEX.md (this package only) from one skills+refs scan. Also the lessons index when lessons exist. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mergeSection, lines } from "./managed-text.ts";
import { isRecord } from "./hook-input.ts";
import { splitFrontmatter } from "./emit-agent-shell-tools.ts";
import { LESSONS_DIR, checkLessons, writeIndex } from "./lessons.ts";
import { PACKAGED_SKILLS_REL, SKILLS_SOURCE_REL } from "./skill-conflicts.ts";

/** A frontmatter value as the small YAML reader below produces it. */
export type YamlValue = string | string[] | YamlObject;
export interface YamlObject {
  [key: string]: YamlValue;
}

export type ParsedArgv = { ok: true; check: boolean } | { ok: false; error: string };

export interface EmitMapsResult {
  ok: boolean;
  check: boolean;
  skipped?: boolean;
  error?: string;
  drift?: string[];
}

interface SkillDir {
  name: string;
  abs: string;
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

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const isEnoent = (err: unknown): boolean => isRecord(err) && err.code === "ENOENT";
const isYamlObject = (v: unknown): v is YamlObject => isRecord(v);

export const INDEX_REL = "references/INDEX.md";
export const STOCK_REFS_PREFIX = "node_modules/@workerstack/repo/references/";
const PACKAGE_NAME = "@workerstack/repo";
const REFS_REL = "references";
const DESC_MAX = 120;
const HUGE_BYTES = 512 * 1024;
const SKIP_REF_NAMES = new Set(["INDEX.md"]);

export function parseArgv(argv: unknown): ParsedArgv {
  const args: unknown[] = Array.isArray(argv) ? argv : [];
  let check = false;
  for (const a of args) {
    if (a === "--check") {
      check = true;
      continue;
    }
    return { ok: false, error: `unknown flag: ${a}` };
  }
  return { ok: true, check };
}

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
  return inner.split(",").map((x) => unquoteYaml(x.trim())).filter((x) => x !== "");
}

function indentOf(line: unknown): number {
  const m = String(line).match(/^[ \t]*/);
  return m ? m[0].length : 0;
}

function parseYamlDoc(fm: unknown): YamlObject {
  const lines = String(fm).split(/\r?\n/);
  // Every call below is guarded by `i < lines.length`, so the fallback never shows.
  const at = (n: number): string => lines[n] ?? "";
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
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function cell(s: unknown): string {
  return oneLine(s).replace(/\|/g, "\\|");
}

function readText(abs: string): string | null {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

function lstat(abs: string): fs.Stats | null {
  try {
    return fs.lstatSync(abs);
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

function posixRel(...parts: string[]): string {
  return parts.join("/").replace(/\\/g, "/");
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

function firstH1(body: unknown): string {
  const m = String(body).match(/^#\s+(.+?)\s*$/m);
  // Group 1 is unconditional in the pattern, so a match has it.
  return m ? m[1]!.replace(/\s+#+\s*$/, "").trim() : "";
}

function firstSummary(body: unknown): string {
  const lines = String(body).split(/\r?\n/);
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

function parseMarkdown(raw: unknown): { parsed: YamlObject; body: string } {
  const src = String(raw ?? "");
  const split = splitFrontmatter(src);
  if (!split.ok) return { parsed: {}, body: src };
  return { parsed: parseYamlDoc(split.fm), body: split.body };
}

function listSkillDirs(ws: string): SkillDir[] {
  const root = path.join(ws, SKILLS_SOURCE_REL);
  let names: fs.Dirent[];
  try {
    names = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
  const out: SkillDir[] = [];
  for (const ent of names) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    const skillAbs = path.join(root, ent.name, "SKILL.md");
    const st = lstat(skillAbs);
    if (st && st.isFile()) out.push({ name: ent.name, abs: skillAbs });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function walkRefMd(dir: string, relBase: string, acc: RefFile[]): RefFile[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (isEnoent(err)) return acc;
    throw err;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    const abs = path.join(dir, ent.name);
    const rel = posixRel(relBase, ent.name);
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

function packagedSkillExists(ws: string, name: string): boolean {
  const abs = path.join(ws, PACKAGED_SKILLS_REL, name, "SKILL.md");
  const st = lstat(abs);
  return Boolean(st && st.isFile());
}

function skillFields(ws: string, skill: SkillDir): SkillFields | null {
  const raw = readText(skill.abs);
  if (raw == null) return null;
  const { parsed, body } = parseMarkdown(raw);
  const name = parsed.name != null && parsed.name !== "" ? String(parsed.name) : skill.name;
  const descSrc =
    parsed.description != null && parsed.description !== "" ? parsed.description : firstSummary(body);
  const commandPath = parsed.commandPath != null ? String(parsed.commandPath) : "";
  const refs = mapRefs(parsed).join(", ");
  const task = mapTask(parsed);
  const origin = packagedSkillExists(ws, skill.name) ? "repo" : "local";
  return { name, origin, descSrc, commandPath, refs, task };
}

function skillRowFromFields(f: SkillFields): string {
  return `| ${cell(f.name)} | ${cell(f.origin)} | ${cell(f.descSrc)} | ${cell(f.task)} | ${cell(f.commandPath)} | ${cell(f.refs)} |`;
}

function refRow(file: RefFile): string | null {
  const shown = `${STOCK_REFS_PREFIX}${file.rel.slice(REFS_REL.length + 1)}`;
  const st = lstat(file.abs);
  if (!st || !st.isFile()) return null;
  const fallbackTitle = path.basename(file.rel, ".md");
  if (st.size > HUGE_BYTES) {
    return `| ${cell(shown)} | ${cell(fallbackTitle)} |  |  |`;
  }
  const raw = readText(file.abs);
  if (raw == null || raw.includes("\0")) {
    return `| ${cell(shown)} | ${cell(fallbackTitle)} |  |  |`;
  }
  const { parsed, body } = parseMarkdown(raw);
  const title = firstH1(body) || fallbackTitle;
  const tags = tagsOf(parsed).join(", ");
  const summary = firstSummary(body);
  return `| ${cell(shown)} | ${cell(title)} | ${cell(tags)} | ${cell(summary)} |`;
}

function skillsTable(rows: string[]): string {
  return [
    "| name | origin | description | task | commandPath | refs |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

function refsTable(rows: string[]): string {
  return [
    "| path | title | tags | summary |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

/** The hand-written text and `repo:stack` of `references/INDEX.md` are never touched; only the two generated sections are. */
const SECTIONS = ["skills", "refs"] as const;

/** Same self check `mergePackageJson` uses (cli/init.ts); mirrored so a product script does not import cli code. */
export function isSelfWorkspace(ws: string): boolean {
  const raw = readText(path.join(ws, "package.json"));
  if (raw == null) return false;
  try {
    const pkg: unknown = JSON.parse(raw);
    return isRecord(pkg) && pkg.name === PACKAGE_NAME;
  } catch {
    return false;
  }
}

export function sectionBody(text: string, name: string): string[] | null {
  const all = lines(text);
  const start = all.findIndex((l) => l.trimEnd() === `<!-- repo:${name} -->`);
  if (start === -1) return null;
  const stop = all.findIndex((l, at) => at > start && l.trimEnd() === `<!-- /repo:${name} -->`);
  return stop === -1 ? null : all.slice(start + 1, stop).map((l) => l.trimEnd());
}

function sectionBodies(ws: string): Record<(typeof SECTIONS)[number], string> {
  const fields = listSkillDirs(ws).map((s) => skillFields(ws, s)).filter((f): f is SkillFields => f != null);
  const skills = fields.map((f) => skillRowFromFields(f));
  const refs = walkRefMd(path.join(ws, REFS_REL), REFS_REL, [])
    .sort((a, b) => a.rel.localeCompare(b.rel))
    .map(refRow)
    .filter((row): row is string => row != null);
  return { skills: skillsTable(skills), refs: refsTable(refs) };
}

export function emitMaps({ workspaceRoot, check = false }: { workspaceRoot?: string; check?: boolean } = {}): EmitMapsResult {
  const ws = workspaceRoot || process.cwd();
  const hasLessons = fs.existsSync(path.join(ws, LESSONS_DIR));
  const indexAbs = path.join(ws, INDEX_REL);
  const disk = isSelfWorkspace(ws) ? readText(indexAbs) ?? "" : null;
  const bodies = disk == null ? null : sectionBodies(ws);

  if (check) {
    if (bodies && disk != null) {
      const stale = SECTIONS.filter((name) => {
        const have = sectionBody(disk, name);
        const want = lines(bodies[name]);
        return have == null || have.length !== want.length || have.some((l, i) => l !== want[i]);
      });
      if (stale.length) {
        const drift = [INDEX_REL];
        return { ok: false, check: true, error: `drift: ${INDEX_REL} (${stale.map((n) => `repo:${n}`).join(", ")})`, drift };
      }
    }
    const lessonErrors = hasLessons ? checkLessons({ workspaceRoot: ws }) : [];
    if (lessonErrors.length) {
      return { ok: false, check: true, error: lessonErrors.join("\n"), drift: [] };
    }
    return { ok: true, check: true, drift: [] };
  }

  if (bodies && disk != null) {
    let text = disk;
    for (const name of SECTIONS) {
      const merged = mergeSection(text, name, bodies[name]);
      if (!merged.ok) return { ok: false, check, error: `${INDEX_REL}: ${merged.error}` };
      text = merged.text;
    }
    if (text !== disk) {
      fs.mkdirSync(path.dirname(indexAbs), { recursive: true });
      fs.writeFileSync(indexAbs, text);
    }
  }
  // The lessons index rides the maps step: a new pipeline command would be seeded as skipped on upgrade.
  if (hasLessons) writeIndex({ workspaceRoot: ws });
  return { ok: true, check: false };
}

function main() {
  try {
    const parsed = parseArgv(process.argv.slice(2));
    if (!parsed.ok) {
      process.stderr.write((parsed.error || "invalid argv") + "\n");
      return 1;
    }
    const result = emitMaps({
      workspaceRoot: process.cwd(),
      check: parsed.check,
    });
    if (!result.ok) {
      process.stderr.write((result.error || "emit failed") + "\n");
      return 1;
    }
    return 0;
  } catch (err) {
    process.stderr.write(errorText(err) + "\n");
    return 1;
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile || import.meta.url === pathToFileURL(invoked).href) {
  process.exit(main());
}
