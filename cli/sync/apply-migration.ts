import fs from "node:fs";
import path from "node:path";

import { CONFIG_FILE } from "../config.constants.ts";
import { loadConfig, type SkillPack } from "../config.ts";
import { moveTree, removeAll, untrack, writeAtomic } from "./migrate-fs.ts";
import { COPIED_DIR, PREFIX } from "./migrate.constants.ts";
import { conflictLines, type MigrateDeps, type MigrationStep } from "./migrate.ts";

/** A step that acts: no conflict survives the early return of `applyMigration`. */
type Acting = Exclude<MigrationStep, { kind: "conflict" }>;

/** The step of one kind. */
type StepOf<K extends Acting["kind"]> = Extract<Acting, { kind: K }>;

/** One run over the steps: the root, the lines printed so far, the paths untracked and whether the copy is gone. */
type Run = { root: string; lines: string[]; untracked: readonly string[]; removed: boolean };

/** What one step does to the run, by kind. */
type Actions = { [K in Acting["kind"]]: (run: Run, step: StepOf<K>) => Promise<void> | void };

const SKILLS_LIST = /skills: (\[[^\]]*\])/;

/** Writes a step's file through a temp file and a rename; the config is checked after and restored when it fails. */
async function writeStep(root: string, step: StepOf<"write">): Promise<string> {
  const file = path.join(root, step.path);
  const before = step.path === CONFIG_FILE ? fs.readFileSync(file, "utf8") : null;
  writeAtomic(file, step.content);

  if (before === null) return step.note;

  const found = SKILLS_LIST.exec(
    step.content,
  ) /* a config step always writes its packs as agents.skills */ as RegExpExecArray;

  const wanted = found[1] /* the pattern's one group always takes part */ as string;
  const loaded = await loadConfig(root);

  function packs() {
    return JSON.parse(wanted) /* the list is the JSON of known packs the plan wrote */ as SkillPack[];
  }

  if (loaded.ok && packs().every((pack) => loaded.config.agents.skills.includes(pack))) return step.note;
  writeAtomic(file, before);

  return `could not add agents.skills ${wanted} to ${CONFIG_FILE}; add agents: { skills: ${wanted} } there`;
}

const ACTIONS: Actions = {
  handover(run, step) {
    for (const file of step.writes) writeAtomic(path.join(run.root, file.path), file.content);
    removeAll(run.root, step.remove);
    run.lines.push(...step.note.split("\n").map((line) => `${PREFIX}${line}`));
  },
  move(run, step) {
    if (step.mark !== undefined) writeAtomic(path.join(run.root, step.mark.path), step.mark.content);
    moveTree(path.join(run.root, step.from), path.join(run.root, step.to), step.except ?? []);
    run.lines.push(`${PREFIX}${step.note}`);

    if (step.mark !== undefined) run.lines.push(`${PREFIX}${step.mark.note}`);
  },
  note(run, step) {
    run.lines.push(`${PREFIX}${step.note}`);
  },
  remove(run, step) {
    removeAll(run.root, step.paths);
    run.removed = true;
  },
  untrack(run, step) {
    untrack(run.root, step.paths);
    run.untracked = step.paths;
  },
  async write(run, step) {
    const written = await writeStep(run.root, step);
    run.lines.push(...written.split("\n").map((line) => `${PREFIX}${line}`));
  },
};

/** The closing line of a run that untracked or removed anything; none otherwise. */
function closingLines(run: Run): string[] {
  const parts = [
    ...(run.untracked.length > 0 ? [`untracked ${run.untracked.join(", ")} (now generated)`] : []),
    ...(run.removed ? [`removed the copied ${COPIED_DIR}/`] : []),
  ];

  if (parts.length === 0) return [];

  return [`${PREFIX}${parts.join(" and ")}${run.untracked.length > 0 ? "; commit the result" : ""}`];
}

/**
 * Runs `steps` in order and returns the `repo sync:` lines. With a conflict among them it changes nothing and
 * returns the conflict lines. A failure throws; the marker is still there, so the next run plans what is left.
 */
export async function applyMigration(
  root: string,
  steps: readonly MigrationStep[],
  deps: MigrateDeps = {},
): Promise<string[]> {
  const conflicts = conflictLines(steps);

  if (conflicts.length > 0) return conflicts;
  const run: Run = { lines: [], removed: false, root, untracked: [] };
  const acting = steps.filter((step): step is Acting => step.kind !== "conflict");

  // In order, one at a time: a crash after step n leaves every later step undone for the next run to plan again.
  for (const [index, step] of acting.entries()) {
    const act = ACTIONS[step.kind] /* each kind's action takes a step of that kind */ as (
      on: Run,
      acted: Acting,
    ) => Promise<void> | void;

    await act(run, step);
    deps.afterStep?.(index);
  }

  return [...run.lines, ...closingLines(run)];
}
