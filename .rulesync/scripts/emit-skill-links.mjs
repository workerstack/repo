#!/usr/bin/env node
/**
 * `.agents/skills/<name>` is the one skills source. Claude reads only `.claude/skills`, so each skill gets a
 * generated link there; npm pack drops symlinks, which is why generate (not the package) creates them.
 * A real dir under `.claude/skills` whose name has no source is a consumer's own skill and stays.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SKILLS_SOURCE_REL, listSkillDirNames } from "./skill-conflicts.mjs";
import { canonicalPath } from "./workspace-root.mjs";

export const CLAUDE_SKILLS_REL = ".claude/skills";
const FIX = "run bun run rulesync:generate";

/** The link text a skill gets everywhere but win32: `../../.agents/skills/<name>`. */
function relTarget(name) {
  return path.posix.relative(CLAUDE_SKILLS_REL, `${SKILLS_SOURCE_REL}/${name}`);
}

function lstat(abs) {
  try {
    return fs.lstatSync(abs);
  } catch {
    return null;
  }
}

/** Where the link at `abs` points, as an absolute canonical path. */
function resolvedTarget(abs) {
  return canonicalPath(path.resolve(path.dirname(abs), fs.readlinkSync(abs)));
}

function danglingIntoSource(root, abs) {
  const target = path.resolve(path.dirname(abs), fs.readlinkSync(abs));
  const source = canonicalPath(path.join(root, SKILLS_SOURCE_REL));
  const rel = path.relative(source, canonicalPath(target));
  return !rel.startsWith("..") && !path.isAbsolute(rel) && rel !== "" && !fs.existsSync(abs);
}

/** @returns {Array<{kind: "link" | "replace" | "prune", name: string}>} */
export function planSkillLinks(root) {
  const sources = listSkillDirNames(path.join(root, SKILLS_SOURCE_REL));
  const claude = path.join(root, CLAUDE_SKILLS_REL);
  const actions = sources.map((name) => {
    const st = lstat(path.join(claude, name));
    return { kind: st && !st.isSymbolicLink() ? "replace" : "link", name };
  });
  let entries = [];
  try {
    entries = fs.readdirSync(claude, { withFileTypes: true });
  } catch {
    // no .claude/skills yet
  }
  const known = new Set(sources);
  for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (known.has(ent.name) || !ent.isSymbolicLink()) continue;
    if (danglingIntoSource(root, path.join(claude, ent.name))) actions.push({ kind: "prune", name: ent.name });
  }
  return actions;
}

function makeLink(root, name) {
  const link = path.join(root, CLAUDE_SKILLS_REL, name);
  const source = path.join(root, SKILLS_SOURCE_REL, name);
  if (lstat(link)?.isSymbolicLink() && resolvedTarget(link) === canonicalPath(source)) return;
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.rmSync(link, { recursive: true, force: true });
  if (process.platform === "win32") fs.symlinkSync(source, link, "junction");
  else fs.symlinkSync(relTarget(name), link);
}

export function emitSkillLinks(root, { log = () => {} } = {}) {
  const counts = { linked: 0, replaced: 0, pruned: 0 };
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

/** @returns {string[]} one FAIL line per skill link that is missing, wrong, shadowed by a real dir, or dangling into the source */
export function checkSkillLinks(root) {
  const failures = [];
  for (const name of listSkillDirNames(path.join(root, SKILLS_SOURCE_REL))) {
    const link = path.join(root, CLAUDE_SKILLS_REL, name);
    const at = `${CLAUDE_SKILLS_REL}/${name}`;
    const st = lstat(link);
    let reason = "";
    if (!st) reason = `missing ${at} -> ${relTarget(name)}`;
    else if (!st.isSymbolicLink()) reason = `real dir ${at} shadows ${SKILLS_SOURCE_REL}/${name}`;
    else if (resolvedTarget(link) !== canonicalPath(path.join(root, SKILLS_SOURCE_REL, name))) {
      reason = `wrong target ${at} -> ${fs.readlinkSync(link)}`;
    }
    if (reason) failures.push(`skill-links FAIL ${reason}: ${FIX}`);
  }
  for (const { kind, name } of planSkillLinks(root)) {
    if (kind === "prune") failures.push(`skill-links FAIL dangling ${CLAUDE_SKILLS_REL}/${name}: ${FIX}`);
  }
  return failures;
}

function main(argv) {
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
