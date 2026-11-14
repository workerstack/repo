/**
 * A session's approval, effort and strategy in one file, .repo/tmp/sessions/<sid>/settings.json. The hook and
 * `repo set` write it; each setting reads the session value first, then (approval only) the newest in-progress plan or
 * roadmap's `approval:`, then the config default.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import type { AgentDefaults } from "../config-resolved.types.ts";
import { tryJson } from "../json.ts";
import { REPO, STATE } from "../repo-dirs.ts";
import type { Result } from "../result.ts";
import type { HookInput } from "./hook-input.ts";
import { itemValue } from "./item-value.ts";
import { countsLine, isRealSession, sessionDir, sessionIdOf } from "./orchestrate-session.ts";
import { ITEM_KIND_LIST } from "./orchestrate.constants.ts";
import type { ItemKind } from "./orchestrate.types.ts";
import { APPROVALS, EFFORTS, STRATEGIES } from "./strategy.constants.ts";
import { parseApprovalSetting, parseStrategy } from "./strategy.ts";
import type { Approval, Effort, Strategy } from "./strategy.types.ts";
import { resolveRoots } from "./workspace-root.ts";

/** What a session has chosen so far; a setting it never named is absent. */
export type SessionSettings = { approval?: Approval; effort?: Effort; strategy?: Strategy };

/** All three settings, each resolved. */
export type Settings = Required<SessionSettings>;

type Named =
  | { key: "approval"; value: Approval }
  | { key: "effort"; value: Effort }
  | { key: "strategy"; value: Strategy };

const SETTING_KEYS: readonly (keyof Settings)[] = ["approval", "effort", "strategy"];
const FILE = "settings.json";
const RANDOM_BYTES = 4;
const HEX = "hex";
const JSON_INDENT = 2;

/** Every setting word, keyed to the setting it names. */
function settingWords(): ReadonlyMap<string, Named> {
  return new Map<string, Named>([
    ...APPROVALS.map((value): [string, Named] => [value, { key: "approval", value }]),
    ...EFFORTS.map((value): [string, Named] => [value, { key: "effort", value }]),
    ...STRATEGIES.map((value): [string, Named] => [value, { key: "strategy", value }]),
  ]);
}

function wordList(): string {
  const words = [...settingWords().keys()];
  const last = words.pop();

  return `${words.join(", ")} or ${last}`;
}

function withSetting(into: SessionSettings, named: Named): SessionSettings {
  if (named.key === "approval") return { ...into, approval: named.value };

  if (named.key === "effort") return { ...into, effort: named.value };

  return { ...into, strategy: named.value };
}

/** The settings the words name; an error line for no words, a word that is no setting, or two words for one setting. */
export function parseSettingWords(words: readonly string[]): Result<SessionSettings, string> {
  if (words.length === 0) return { error: `set: name a setting: ${wordList()}`, ok: false };
  const firstWord = new Map<keyof Settings, string>();
  const known = settingWords();
  let change: SessionSettings = {};

  for (const word of words) {
    const named = known.get(word);

    if (named === undefined) return { error: `set: "${word}" is not a setting; use ${wordList()}`, ok: false };
    const earlier = firstWord.get(named.key);

    if (earlier !== undefined && earlier !== word)
      return { error: `set: ${earlier} and ${word} both set ${named.key}; pick one`, ok: false };

    firstWord.set(named.key, word);
    change = withSetting(change, named);
  }

  return { ok: true, value: change };
}

/** The settings file of session `sid` under the resolved root. */
export function settingsPath(root: string, sid: string): string {
  return path.join(root, REPO, STATE, "sessions", sid, FILE);
}

/** What the session saved; an unreadable or bad file reads as none, and a value that is no setting is dropped. */
export function readSessionSettings(root: string, sid: string): SessionSettings {
  let text: string;

  try {
    text = fs.readFileSync(settingsPath(root, sid), "utf8");
  } catch {
    return {};
  }

  const saved = tryJson(
    z.looseObject({
      approval: z.string().optional().catch(undefined),
      effort: z.string().optional().catch(undefined),
      strategy: z.string().optional().catch(undefined),
    }),
    text,
  );

  const approval = parseApprovalSetting(saved?.approval);
  const effort = EFFORTS.find((e) => e === saved?.effort);
  const strategy = parseStrategy(saved?.strategy);

  return {
    ...(approval === null ? {} : { approval }),
    ...(effort === undefined ? {} : { effort }),
    ...(strategy === null ? {} : { strategy }),
  };
}

/** Merge `change` into the session's file. The temp name has the pid and a random part: no two writers share one. */
export function writeSessionSettings(root: string, sid: string, change: SessionSettings): void {
  const file = settingsPath(root, sid);
  const temp = `${file}.${process.pid}-${randomBytes(RANDOM_BYTES).toString(HEX)}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });

  try {
    fs.writeFileSync(temp, `${JSON.stringify({ ...readSessionSettings(root, sid), ...change }, null, JSON_INDENT)}\n`);
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

/** The roadmap kind whose in-progress item gives a new plan of each kind its strategy; a roadmap has none. */
const PARENT_OF: Readonly<Record<ItemKind, ItemKind | null>> = {
  "fast-plan": "fast-roadmap",
  "fast-roadmap": null,
  plan: "roadmap",
  roadmap: null,
};

/**
 * The strategy a new item of `kind` is saved with: the session value, then (a plan or fast plan only) the `strategy:`
 * of the newest in-progress roadmap of its parent kind this session saved, then `defaults`.
 */
export function saveStrategy(data: HookInput, defaults: AgentDefaults, kind: ItemKind): Strategy {
  const sid = sessionIdOf(data);
  const saved = isRealSession(sid) ? readSessionSettings(resolveRoots(data).root, sid).strategy : undefined;
  const parentKind = PARENT_OF[kind];
  const parent = parentKind === null ? null : itemValue(data, (fm) => parseStrategy(fm.strategy), [parentKind]);

  return saved ?? parent ?? defaults.defaultStrategy;
}

/**
 * The settings this session runs. A session value wins; approval then reads the newest in-progress plan or roadmap in
 * this session's approvals; each then falls to `defaults`. Another session's files never count.
 */
export function effectiveSettings(data: HookInput, defaults: AgentDefaults): Settings {
  const sid = sessionIdOf(data);
  const saved = isRealSession(sid) ? readSessionSettings(resolveRoots(data).root, sid) : {};

  return {
    approval:
      saved.approval ??
      itemValue(data, (fm) => parseApprovalSetting(fm.approval), ITEM_KIND_LIST) ??
      defaults.defaultApproval,
    effort: saved.effort ?? defaults.defaultEffort,
    strategy: saved.strategy ?? defaults.defaultStrategy,
  };
}

/** What a change did to settings that held `before`: each that moved with its old value, or that none did. */
export function changeLine(before: Settings, named: SessionSettings): string {
  const moved = SETTING_KEYS.filter((k) => named[k] !== undefined && named[k] !== before[k]);

  if (moved.length > 0) return `set ${moved.map((k) => `${k} ${named[k]} (was ${before[k]})`).join(", ")}`;
  const held = SETTING_KEYS.filter((k) => named[k] !== undefined);

  return `set: no change; ${held.map((k) => `${k} is already ${before[k]}`).join(", ")}`;
}

/**
 * An approved `i <word>` sets this session's strategy: the change line, from the effective settings, and the write.
 * Empty, with no write, when the payload names no real session.
 */
export function setSessionStrategy(data: HookInput, defaults: AgentDefaults, strategy: Strategy): string {
  const sid = sessionIdOf(data);

  if (!isRealSession(sid)) return "";
  const change = { strategy };
  const line = changeLine(effectiveSettings(data, defaults), change);
  writeSessionSettings(resolveRoots(data).root, sid, change);

  return line;
}

/**
 * The parse, change line and write steps of `/set` and `repo set`: the words become settings, the line says what moved
 * from the session's effective settings, and the store takes the change. An error line writes nothing.
 */
export function setSessionSettings(
  data: HookInput,
  words: readonly string[],
  defaults: AgentDefaults,
): Result<string, string> {
  const parsed = parseSettingWords(words);

  if (!parsed.ok) return parsed;
  const line = changeLine(effectiveSettings(data, defaults), parsed.value);
  writeSessionSettings(resolveRoots(data).root, sessionIdOf(data), parsed.value);

  return { ok: true, value: line };
}

const SET_RE = /^\s*\/set(?=\s|$)(.*)$/s;
const WORD_SPLIT = /\s+/;

const SLASHES: readonly (readonly [RegExp, Approval])[] = [
  [/^\s*\/ask(?=\s|$)/, "ask"],
  [/^\s*\/away(?=\s|$)/, "away"],
];

/**
 * A prompt that starts with /set, /ask or /away writes this session's store. Returns the change, no-change or error
 * line for /set; null for anything else, for /ask and /away, and when the payload names no real session.
 */
export function applyPromptSettings(data: HookInput, prompt: string, defaults: AgentDefaults): string | null {
  const sid = sessionIdOf(data);

  if (!isRealSession(sid)) return null;
  const slash = SLASHES.find(([re]) => re.test(prompt))?.[1];

  if (slash !== undefined) {
    writeSessionSettings(resolveRoots(data).root, sid, { approval: slash });

    return null;
  }

  const set = SET_RE.exec(prompt);

  if (set === null) return null;
  const done = setSessionSettings(data, set.slice(1).join("").split(WORD_SPLIT).filter(Boolean), defaults);

  return done.ok ? done.value : done.error;
}

function sessionReceiptContext(data: HookInput): string {
  const sid = sessionIdOf(data);

  if (!isRealSession(sid)) return "";
  const dir = sessionDir(data, sid);

  if (!fs.existsSync(dir)) return "";

  return `${countsLine(dir)} session=${REPO}/${STATE}/sessions/${sid}/`;
}

/** The context line: all three settings, then the session's counts and dir once the session has one. */
export function settingsContext(data: HookInput, defaults: AgentDefaults): string {
  const { approval, effort, strategy } = effectiveSettings(data, defaults);
  const line = `approval=${approval} effort=${effort} strategy=${strategy}`;
  const receipt = sessionReceiptContext(data);

  return receipt === "" ? line : `${line}. ${receipt}`;
}
