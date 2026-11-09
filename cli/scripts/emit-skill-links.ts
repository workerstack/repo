#!/usr/bin/env bun
/**
 * `agents/skills/<name>` is the stock skills source. Claude reads only `.claude/skills`, so each skill gets a
 * generated link there; npm pack drops symlinks, which is why generate (not the package) creates them.
 * A real dir under `.claude/skills` whose name has no source is a consumer's own skill and stays.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STOCK_SKILLS_REL, listSkillDirNames } from "./skill-conflicts.ts";
import { canonicalPath } from "./workspace-root.ts";

export const CLAUDE_SKILLS_REL = ".claude/skills";

/** One step of the plan: link a skill, replace a real dir with its link, or prune a dangling link. */
export interface SkillLinkAction {
  kind: "link" | "replace" | "prune";
  name: string;
}

export interface SkillLinkCounts {
  linked: number;
  replaced: number;
  pruned: number;
}

const FIX = "run bun repo sync";

/** The link text a skill gets everywhere but win32: `../../agents/skills/<name>`. */
function relTarget(name: string): string {
  return path.posix.relative(CLAUDE_SKILLS_REL, `${STOCK_SKILLS_REL}/${name}`);
}

function lstat(abs: string): fs.Stats | null {
  try {
    return fs.lstatSync(abs);
  } catch {
    return null;
  }
}

/** Where the link at `abs` points, as an absolute canonical path. */
function resolvedTarget(abs: string): string {
  return canonicalPath(path.resolve(path.dirname(abs), fs.readlinkSync(abs)));
}

function danglingIntoSource(skillsRoot: string, abs: string): boolean {
  const target = path.resolve(path.dirname(abs), fs.readlinkSync(abs));
  const source = canonicalPath(path.join(skillsRoot, STOCK_SKILLS_REL));
  const rel = path.relative(source, canonicalPath(target));
  return !rel.startsWith("..") && !path.isAbsolute(rel) && rel !== "" && !fs.existsSync(abs);
}

/** `skillsRoot` is the dir whose `agents/skills` holds the skills (default `root`, which owns `.claude/skills`). */
export function planSkillLinks(root: string, { skillsRoot = root }: { skillsRoot?: string } = {}): SkillLinkAction[] {
  const sources = listSkillDirNames(path.join(skillsRoot, STOCK_SKILLS_REL));
  const claude = path.join(root, CLAUDE_SKILLS_REL);
  const actions: SkillLinkAction[] = sources.map((name) => {
    const st = lstat(path.join(claude, name));
    return { kind: st && !st.isSymbolicLink() ? "replace" : "link", name };
  });
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(claude, { withFileTypes: true });
  } catch {
    // no .claude/skills yet
  }
  const known = new Set(sources);
  for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (known.has(ent.name) || !ent.isSymbolicLink()) continue;
    if (danglingIntoSource(skillsRoot, path.join(claude, ent.name))) actions.push({ kind: "prune", name: ent.name });
  }
  return actions;
}

function makeLink(root: string, name: string): void {
  const link = path.join(root, CLAUDE_SKILLS_REL, name);
  const source = path.join(root, STOCK_SKILLS_REL, name);
  if (lstat(link)?.isSymbolicLink() && resolvedTarget(link) === canonicalPath(source)) return;
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.rmSync(link, { recursive: true, force: true });
  if (process.platform === "win32") fs.symlinkSync(source, link, "junction");
  else fs.symlinkSync(relTarget(name), link);
}

export function emitSkillLinks(root: string, { log = () => {} }: { log?: (msg: string) => unknown } = {}): SkillLinkCounts {
  const counts: SkillLinkCounts = { linked: 0, replaced: 0, pruned: 0 };
  for (const { kind, name } of planSkillLinks(root)) {
    if (kind === "prune") {
      fs.rmSync(path.join(root, CLAUDE_SKILLS_REL, name), { force: true });
      log(`pruned ${CLAUDE_SKILLS_REL}/${name} (dangling link)`);
      counts.pruned++;
      continue;
    }
    makeLink(root, name);
    counts.linked++;
    if (kind === "replace") {
      log(`replaced ${CLAUDE_SKILLS_REL}/${name} (real dir) with link`);
      counts.replaced++;
    }
  }
  return counts;
}

/** A link's target relative to its dir in forward slashes, the way a win32 junction's absolute target reads too. */
function linkText(link: string): string {
  const dir = path.dirname(link);
  return path.relative(dir, path.resolve(dir, fs.readlinkSync(link))).split(path.sep).join("/");
}

/** One FAIL line per skill link that is missing, wrong, shadowed by a real dir, or dangling into the source. */
export function checkSkillLinks(root: string): string[] {
  const failures: string[] = [];
  for (const name of listSkillDirNames(path.join(root, STOCK_SKILLS_REL))) {
    const link = path.join(root, CLAUDE_SKILLS_REL, name);
    const at = `${CLAUDE_SKILLS_REL}/${name}`;
    const st = lstat(link);
    let reason = "";
    if (!st) reason = `missing ${at} -> ${relTarget(name)}`;
    else if (!st.isSymbolicLink()) reason = `real dir ${at} shadows ${STOCK_SKILLS_REL}/${name}`;
    else if (resolvedTarget(link) !== canonicalPath(path.join(root, STOCK_SKILLS_REL, name))) {
      reason = `wrong target ${at} -> ${linkText(link)}`;
    }
    if (reason) failures.push(`skill-links FAIL ${reason}: ${FIX}`);
  }
  for (const { kind, name } of planSkillLinks(root)) {
    if (kind === "prune") failures.push(`skill-links FAIL dangling ${CLAUDE_SKILLS_REL}/${name}: ${FIX}`);
  }
  return failures;
}

function main(argv: string[]): number {
  const check = argv.includes("--check");
  const bad = argv.find((a) => a !== "--check");
  if (bad) {
    process.stderr.write(`unknown flag: ${bad}\n`);
    return 1;
  }
  const root = process.cwd();
  if (check) {
    const failures = checkSkillLinks(root);
    if (failures.length) {
      process.stderr.write(`${failures.join("\n")}\n`);
      return 1;
    }
    process.stdout.write("skill-links: ok\n");
    return 0;
  }
  const { linked, replaced, pruned } = emitSkillLinks(root, { log: (m) => process.stdout.write(`${m}\n`) });
  process.stdout.write(`skill-links: ${linked} linked, ${replaced} replaced, ${pruned} pruned\n`);
  return 0;
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile) process.exit(main(process.argv.slice(2)));
