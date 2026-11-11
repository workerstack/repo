import fs from "node:fs";
import path from "node:path";

import type { Host, ResolvedConfig } from "../config.ts";
import { isRecord } from "../scripts/hook-input.ts";
import { sortedJsonValue } from "../scripts/json-keys.ts";
import { isAgentsFile } from "./agents-file.ts";
import { untrackedEntries } from "./git-files.ts";
import { isHostOutput } from "./hosts.ts";
import { isRealDir, present, same, stockRel, trackedRels } from "./migrate-fs.ts";
import { ownHooks, parseJson, readJson, settingsExtras } from "./migrate-settings.ts";
import {
  ADOPTABLE,
  CLAUDE_OVERLAY,
  CLAUDE_SETTINGS,
  PREFIX,
  REFERENCES_DIR,
  REPO_DIR,
  SKILL_ROOTS,
} from "./migrate.constants.ts";
import type { MigrateDeps } from "./migrate.ts";
import { editedSkill } from "./migration-docs.ts";
import { planUntrack } from "./migration-finish.ts";
import type { MigrationState } from "./migration-state.ts";
import type { Output } from "./outputs.ts";
import { PACKAGE_NAME } from "./package-name.constants.ts";
import { HOOK_COMMANDS_KEY, hashText, hookCommands } from "./stock-history.ts";

/** What adoption reads: the config, the outputs sync plans, the paths the last sync wrote and how git is asked. */
type AdoptInput = {
  config: ResolvedConfig;
  outputs: readonly Output[];
  owned: ReadonlySet<string>;
  tracked: NonNullable<MigrateDeps["tracked"]>;
};

/** One adoption run: the state, the enabled hosts, what sync owns or plans, the real skill dirs and the stops. */
type Adoption = {
  state: MigrationState;
  hosts: readonly Host[];
  owned: ReadonlySet<string>;
  planned: ReadonlySet<string>;
  skillDirs: readonly string[];
  stops: Set<string>;
};

/** Whether a command is one the stock settings or a past stock version ran. */
function knownCommand(state: MigrationState, base: Record<string, unknown>): (command: string) => boolean {
  const stockCommands = new Set(hookCommands(base));
  return (command) =>
    stockCommands.has(command) || state.history[HOOK_COMMANDS_KEY]?.includes(hashText(command)) === true;
}

/** The keys and hooks of the user's settings that the stock's own lack, written to the overlay. */
function carrySettings(state: MigrationState, have: Record<string, unknown>, base: Record<string, unknown>): void {
  const { hooks, ...mine } = have;
  const paths: string[] = [];
  const extras = settingsExtras(mine, base, { at: "", paths });
  const own = ownHooks(hooks, knownCommand(state, base));
  if (extras === undefined && own.events.length === 0) return;
  const content = {
    ...(extras /* the extras of two objects are an object or undefined */ as Record<string, unknown> | undefined),
    ...(own.events.length > 0 ? { hooks: own.hooks } : {}),
  };
  const lines = [
    ...(paths.length > 0 ? [`moved your ${CLAUDE_SETTINGS} keys ${paths.join(", ")} to ${CLAUDE_OVERLAY}`] : []),
    ...own.events.map(
      ([event, count]) => `moved your ${CLAUDE_SETTINGS} hooks ${event} (${count}) to ${CLAUDE_OVERLAY}`,
    ),
  ];
  state.write(CLAUDE_SETTINGS, CLAUDE_OVERLAY, { content: sortedJsonValue(content), note: lines.join("\n") });
  state.drop.push(CLAUDE_SETTINGS);
}

/** `.claude/settings.json` keys the stock's own settings lack go to the overlay; `hooks` come from hooks.jsonc. */
export function planClaudeSettings(state: MigrationState): void {
  const raw = state.read(CLAUDE_SETTINGS);
  if (raw !== null && state.unedited(CLAUDE_SETTINGS, raw, state.stockText(CLAUDE_SETTINGS))) return;
  const have = readJson(path.join(state.root, CLAUDE_SETTINGS));
  if (have === null) {
    const note = `${CLAUDE_SETTINGS} is not valid JSON; copy any keys of yours into ${CLAUDE_OVERLAY}`;
    state.steps.push({ kind: "note", note });
    return;
  }
  const base = parseJson(state.stockText(CLAUDE_SETTINGS));
  if (isRecord(have) && isRecord(base)) carrySettings(state, have, base);
}

/** Moves the keys of a hand-written claude settings file that sync does not generate; one that is no JSON object stops the run. */
function adoptSettings(run: Adoption, text: string): void {
  let have: unknown;
  try {
    have = JSON.parse(text);
  } catch {
    have = null;
  }
  if (isRecord(have)) planClaudeSettings(run.state);
  else run.stops.add(CLAUDE_SETTINGS);
}

/** The real skill dirs of the host skill dirs sync does not own; an edited one moves to `.repo/skills`. */
function adoptSkillDirs(state: MigrationState, hosts: readonly Host[], owned: ReadonlySet<string>): string[] {
  const skillDirs: string[] = [];
  for (const dir of SKILL_ROOTS.filter((root) => isHostOutput(hosts, `${root}/x`))) {
    for (const name of state.names(dir)) {
      const from = `${dir}/${name}`;
      if (owned.has(from) || !isRealDir(path.join(state.root, from))) continue;
      skillDirs.push(from);
      if (!editedSkill(state, from)) continue;
      const to = `${REPO_DIR}/skills/${name}`;
      const stocked = present(path.join(state.stock, stockRel(from)));
      const mark = stocked ? state.mark(`${from}/SKILL.md`, `${to}/SKILL.md`, { kind: "skill", name }) : undefined;
      state.move(from, to, { mark, note: `moved ${from} to ${to}` });
    }
  }
  return skillDirs;
}

/**
 * A host file that holds text of the user's: claude settings move to `.repo/` when they can, a root or package
 * `AGENTS.md` keeps its text where it is, and any other stops the run.
 */
function adoptText(run: Adoption, rel: string, content: string): void {
  const text = run.state.text(rel);
  if (same(text, content) || run.state.unedited(rel, text, run.state.stockText(rel))) return;
  if (!ADOPTABLE.has(rel) && !isAgentsFile(rel)) run.stops.add(rel);
  else if (rel === CLAUDE_SETTINGS) adoptSettings(run, text);
}

/** What the consumer already keeps where sync plans `output`, unless sync owns it or it is a link or a skill dir. */
function adoptOutput(run: Adoption, output: Output): void {
  if (run.owned.has(output.path) || !isHostOutput(run.hosts, output.path)) return;
  const found = fs.lstatSync(path.join(run.state.root, output.path), { throwIfNoEntry: false });
  if (found === undefined || found.isSymbolicLink() || run.skillDirs.includes(output.path)) return;
  if (output.kind === "link" || found.isDirectory()) run.stops.add(output.path);
  else adoptText(run, output.path, output.content);
}

/** Whether a tracked path is no host file of the user's: sync owns or plans it, adoption took it, or no host reads it. */
function skipsTracked(run: Adoption, rel: string): boolean {
  if (run.owned.has(rel) || run.planned.has(rel) || ADOPTABLE.has(rel)) return true;
  return run.skillDirs.some((dir) => rel.startsWith(`${dir}/`)) || !isHostOutput(run.hosts, rel);
}

/** A tracked host file sync does not plan stops the run unless it is a link or a stock version. */
function stopTracked(run: Adoption, rel: string): void {
  if (skipsTracked(run, rel)) return;
  const found = fs.lstatSync(path.join(run.state.root, rel), { throwIfNoEntry: false });
  if (found === undefined || found.isSymbolicLink()) return;
  if (!run.state.unedited(rel, run.state.text(rel), run.state.stockText(rel))) run.stops.add(rel);
}

/**
 * What the consumer already keeps where sync generates, for a repo that never ran the copying init: see
 * `planAdoption`. Nothing it cannot move is left to be overwritten or hidden by the gitignore block.
 */
export function planAdopt(state: MigrationState, input: AdoptInput): void {
  const { hosts } = input.config.agents;
  const ignored = untrackedEntries(hosts, input.outputs);
  const skillDirs = adoptSkillDirs(state, hosts, input.owned);
  const planned = new Set(input.outputs.map((output) => output.path));
  const run: Adoption = { hosts, owned: input.owned, planned, skillDirs, state, stops: new Set() };
  for (const output of input.outputs) adoptOutput(run, output);
  for (const rel of trackedRels(input.tracked(state.root, [...ignored]) ?? [], state.root)) stopTracked(run, rel);
  for (const rel of [...run.stops].sort()) {
    const line = `${PREFIX}${rel} is yours and would be ignored; move it under ${REPO_DIR}/ (see node_modules/${PACKAGE_NAME}/${REFERENCES_DIR}/map.md) or delete it, then run \`bun repo sync\``;
    state.steps.push({ from: rel, kind: "conflict", line, to: "" });
  }
  if (run.stops.size === 0 && state.steps.length > 0) planUntrack(state, ignored, input.tracked);
}
