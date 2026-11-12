/** Reading, merging and writing hook files: groups union by hook, flat entries drop what they replace. */
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { isRecord, type Json, type JsonInput, readJson, type JsonObject } from "../json.ts";
import { hookNameOf } from "./hook-command.ts";
import { COMMAND_KEY, JSON_INDENT } from "./hooks-union.constants.ts";
import type { HookEntry, HookGroup } from "./hooks-union.types.ts";

/** A script file name in a command. */
const SCRIPT_FILE = /([\w.-]+\.(?:ts|mjs|js)\b)/;

function commandsIn(group: Json): string[] {
  if (!isRecord(group)) return [];
  const out: string[] = [];

  if (typeof group.command === "string") out.push(group.command);
  const hooks = Array.isArray(group.hooks) ? group.hooks : [];

  for (const h of hooks) if (isRecord(h) && typeof h.command === "string") out.push(h.command);

  return out;
}

/** What makes two groups the same hook: the repo hook name in either command form, else the script file name. */
function needleOf(group: Json): string {
  const commands = commandsIn(group);

  for (const c of commands) {
    const name = hookNameOf(c);

    if (name !== null) return `hook:${name}`;
    const file = SCRIPT_FILE.exec(c)?.[1];

    if (file !== undefined) return file;
  }

  const [first] = commands;

  return first === undefined || first === "" ? JSON.stringify(group) : first;
}

/** `desired` first, then each existing group that is not the same hook as one of them. */
export function upsertGroups(existing: Json | undefined, desired: Json[]): Json[] {
  const prev = Array.isArray(existing) ? existing : [];
  const desiredNeedles = new Set(desired.map(needleOf));
  const extras = prev.filter((g) => !desiredNeedles.has(needleOf(g)));

  return [...desired, ...extras];
}

/** `arr` with each value once, at its first place. */
export function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/** The JSON object at `p`, or `{}` when the file is missing, blank or not an object. */
export function loadJson(p: string): JsonObject {
  if (!fs.existsSync(p)) return {};
  const raw = fs.readFileSync(p, "utf8");

  if (raw.trim() === "") return {};

  return readJson(z.record(z.string(), z.json()).catch({}), raw);
}

export function saveJson(p: string, obj: JsonInput): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(obj, null, JSON_INDENT)}\n`);
}

/**
 * Antigravity rejects the `{matcher, hooks}` group form for SessionStart: flat entries, `extra` after what is there.
 */
export function flatSession(existing: Json | undefined, extra: HookEntry[]): Json[] {
  const prev = (Array.isArray(existing) ? existing : []).flatMap((e): Json[] =>
    isRecord(e) && Array.isArray(e.hooks) ? e.hooks : [e],
  );

  const added = new Set(extra.map((h) => h.command));

  return [...prev.filter((e) => !(isRecord(e) && typeof e.command === "string" && added.has(e.command))), ...extra];
}

/** `{matcher, hooks}` groups as the flat `{...hook, matcher}` entries Cursor reads. */
export function flatEntries(groups: HookGroup[]): (HookEntry & { matcher: string })[] {
  return groups.flatMap((g) => g.hooks.map((h) => ({ ...h, matcher: g.matcher })));
}

/** Every `command` string anywhere in `value`, in document order. */
export function allCommands(value: Json | undefined, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) allCommands(v, out);
  } else if (isRecord(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k === COMMAND_KEY && typeof v === "string") out.push(v);
      else allCommands(v, out);
    }
  }

  return out;
}
