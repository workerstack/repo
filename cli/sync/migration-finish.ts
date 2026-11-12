import path from "node:path";

import { CONFIG_FILE } from "../config.constants.ts";
import { SKILL_PACKS, type SkillPack } from "../config.ts";
import { stripJsonc } from "../scripts/strip-jsonc.ts";
import { filesUnder, isDir, trackedRels } from "./migrate-fs.ts";
import {
  CLAUDE_OVERLAY,
  COPIED_CLAUDE_SETTINGS,
  COPIED_DIR,
  COPIED_MARKER,
  HANDLED,
  PREFIX,
  REFERENCES_DIR,
} from "./migrate.constants.ts";
import type { MigrateDeps } from "./migrate.ts";
import type { MigrationState } from "./migration-state.ts";

const FEATURES = `${COPIED_DIR}/repo.features.jsonc`;

/** A config `packs: [...]` list: its head up to `[` in group 1, its items in group 2. */
const PACKS_LIST = /(\bpacks\s*:\s*\[)([^\]]*)\]/;

/** A quoted "agents" item. */
const AGENTS_ITEM = /["']agents["']/;

/** A config `skills: [...]` list, its items in group 1. */
const SKILLS_LIST = /\bskills\s*:\s*\[([^\]]*)\]/;

/** The opening of the `defineConfig({` call. */
const DEFINE_CONFIG_OPEN = /defineConfig\(\s*\{/;

/** An `agents:` key, quoted or not. */
const AGENTS_KEY = /["']?\bagents\b["']?\s*:/;

/** A conflict for the user's `rel`: no `.repo/` entry takes it, so it cannot move there. */
function unread(state: MigrationState, rel: string): void {
  state.steps.push({
    from: rel,
    kind: "conflict",
    line:
      `${PREFIX}${rel} is yours and nothing reads it; move it out of ${COPIED_DIR} ` +
      `(to ${REFERENCES_DIR}/ if it explains something) or delete it, then run \`bun repo sync\``,
    to: "",
  });
}

/**
 * Files of the copied dir that were never meant to be edited (scripts, the pipeline file, the settings) go only when
 * they match a stock version. An edited `settings/claude.json` is the overlay's own file and moves there; any other
 * edited or own file is one nothing reads, so it stops the run.
 */
export function planCopies(state: MigrationState): void {
  for (const base of [`${COPIED_DIR}/scripts`, `${COPIED_DIR}/settings`]) {
    const files = isDir(path.join(state.root, base)) ? filesUnder(path.join(state.root, base)) : [];

    for (const from of files.map((file) => `${base}/${file}`)) {
      if (from === COPIED_MARKER || state.unedited(from, state.text(from), state.stockText(from))) continue;

      if (from === COPIED_CLAUDE_SETTINGS)
        state.move(from, CLAUDE_OVERLAY, { note: `moved your ${from} to ${CLAUDE_OVERLAY}` });
      else unread(state, from);
    }
  }

  const pipeline = `${COPIED_DIR}/repo.pipeline.jsonc`;

  if (state.differs(pipeline, state.stockText(pipeline))) unread(state, pipeline);
}

/** Anything else in the copied dir is the consumer's and nothing reads it, so it stops the run. */
export function planLeftovers(state: MigrationState): void {
  for (const name of state.names(COPIED_DIR).filter((entry) => !HANDLED.has(entry)))
    unread(state, `${COPIED_DIR}/${name}`);
}

/** The known packs `repo.features.jsonc` lists, each once; none when it is missing or no JSON. */
function featurePacks(state: MigrationState): SkillPack[] {
  let packs: unknown;

  try {
    ({ packs } = JSON.parse(
      stripJsonc(state.read(FEATURES) ?? ""),
    ) /* a features file is an object of packs, any other value throws here */ as {
      packs?: unknown;
    });
  } catch {
    return [];
  }

  const known = (Array.isArray(packs) ? packs : []).filter((pack): pack is SkillPack =>
    SKILL_PACKS.some((name) => name === pack),
  );

  return [...new Set(known)];
}

/** The config text with "agents" added to its `packs` list when it has one without it; agents.skills needs the pack. */
function withAgentsPack(text: string): string {
  return text.replace(PACKS_LIST, (whole, head: string, items: string) => {
    if (AGENTS_ITEM.test(items)) return whole;
    const kept = items.trimEnd();

    return `${head}${kept}${kept === "" ? "" : ", "}"agents"]`;
  });
}

/** Whether the config text already lists every pack in an `agents.skills` array. */
function configHasSkills(text: string, packs: readonly string[]): boolean {
  const list = SKILLS_LIST.exec(text)?.[1];

  return list !== undefined && packs.every((pack) => list.includes(`"${pack}"`) || list.includes(`'${pack}'`));
}

/** The packs of `repo.features.jsonc` become `agents.skills` in the config. */
export function planPacks(state: MigrationState): void {
  const packs = featurePacks(state);
  const text = state.text(CONFIG_FILE);

  if (packs.length === 0 || configHasSkills(text, packs)) return;
  const list = `[${packs.map((pack) => JSON.stringify(pack)).join(", ")}]`;
  const open = DEFINE_CONFIG_OPEN.exec(text);

  if (open === null || AGENTS_KEY.test(text)) {
    const hint = `add agents: { skills: ${list} } there`;
    const note = `could not add the packs ${list} of ${FEATURES} to ${CONFIG_FILE}; ${hint}`;
    state.steps.push({ kind: "note", note });

    return;
  }

  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const at = open.index + open[0].length;
  const inserted = `${text.slice(0, at)}${eol}  agents: { skills: ${list} },${text.slice(at)}`;
  const note = `moved packs ${list} from ${FEATURES} to agents.skills in ${CONFIG_FILE}`;
  state.steps.push({ content: withAgentsPack(inserted), kind: "write", note, path: CONFIG_FILE });
}

/** The generated paths git still tracks; none outside git. */
export function planUntrack(
  state: MigrationState,
  candidates: readonly string[],
  tracked: NonNullable<MigrateDeps["tracked"]>,
): void {
  const raw = tracked(state.root, [...candidates]);

  if (raw === null) return;
  const rels = trackedRels(raw, state.root);

  const paths = candidates.filter((entry) =>
    rels.some((rel) => (entry.endsWith("/") ? rel.startsWith(entry) : rel === entry)),
  );

  if (paths.length > 0) state.steps.push({ kind: "untrack", paths });
}

/** Last: the stock copies of skills, then the copied dir. */
export function planRemove(state: MigrationState): void {
  state.steps.push({ kind: "remove", paths: [...state.drop, COPIED_DIR] });
}
