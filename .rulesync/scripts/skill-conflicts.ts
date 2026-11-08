#!/usr/bin/env bun
/** Workspace vs packaged repo skill content conflicts (warn-only). */
import fs from "node:fs";
import path from "node:path";
import { isRecord } from "./hook-input.ts";

/** The one skills source in a repo and in a consumer; every skill-dir consumer imports this. */
export const SKILLS_SOURCE_REL = ".agents/skills";
export const PACKAGED_SKILLS_REL = path.join(
  "node_modules",
  "@workerstack",
  "repo",
  ...SKILLS_SOURCE_REL.split("/"),
);

export function listSkillDirNames(skillsRoot: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
  } catch (err) {
    if (isRecord(err) && err.code === "ENOENT") return [];
    throw err;
  }
  const out: string[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    const skillMd = path.join(skillsRoot, ent.name, "SKILL.md");
    try {
      if (!fs.statSync(skillMd).isFile()) continue;
    } catch {
      continue;
    }
    out.push(ent.name);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function readSkillMd(skillsRoot: string, name: string): Buffer | null {
  const abs = path.join(skillsRoot, name, "SKILL.md");
  try {
    return fs.readFileSync(abs);
  } catch {
    return null;
  }
}

/** Names in both trees whose SKILL.md bytes differ. */
export interface SkillConflict {
  name: string;
  workspacePath: string;
  packagedPath: string;
}

export function findSkillContentConflicts({
  workspaceSkillsDir,
  packagedSkillsDir,
}: { workspaceSkillsDir?: string; packagedSkillsDir?: string } = {}): SkillConflict[] {
  if (!workspaceSkillsDir || !packagedSkillsDir) return [];
  const packaged = listSkillDirNames(packagedSkillsDir);
  if (!packaged.length) return [];
  const conflicts: SkillConflict[] = [];
  for (const name of packaged) {
    const ws = readSkillMd(workspaceSkillsDir, name);
    if (ws == null) continue;
    const pkg = readSkillMd(packagedSkillsDir, name);
    if (pkg == null) continue;
    if (Buffer.compare(ws, pkg) !== 0) {
      conflicts.push({
        name,
        workspacePath: path.join(workspaceSkillsDir, name, "SKILL.md"),
        packagedPath: path.join(packagedSkillsDir, name, "SKILL.md"),
      });
    }
  }
  return conflicts;
}

export function formatSkillConflictWarn(name: string): string {
  return `skill \`${name}\` differs from packaged repo; re-init overwrites`;
}
