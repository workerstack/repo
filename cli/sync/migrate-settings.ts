import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";

import { isRecord } from "../scripts/hook-input.ts";
import { MD, RULE_FRONTMATTER } from "./migrate.constants.ts";

/** Where `settingsExtras` is in the value it walks, and the dotted paths of the pieces it found so far. */
type Trail = { at: string; paths: string[] };

/** The hooks a settings file carries over, and each carried event with its group count. */
type OwnHooks = { hooks: Record<string, unknown[]>; events: [string, number][] };

/** The JSON value of `text`: undefined for no text, null when it is not JSON. */
export function parseJson(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The parsed file; undefined when it is missing, null when it is not valid JSON. */
export function readJson(file: string): unknown {
  try {
    return parseJson(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function keep(value: unknown, trail: Trail): unknown {
  trail.paths.push(trail.at);
  return value;
}

/** The keys of `have` that `base` lacks or holds otherwise, as `settingsExtras` finds them; undefined when none. */
function objectExtras(have: Record<string, unknown>, base: Record<string, unknown>, trail: Trail): unknown {
  const found: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(have)) {
    const next = { at: trail.at === "" ? key : `${trail.at}.${key}`, paths: trail.paths };
    const extra = key in base ? settingsExtras(value, base[key], next) : keep(value, next);
    if (extra !== undefined) found[key] = extra;
  }
  return Object.keys(found).length > 0 ? found : undefined;
}

/**
 * What `have` holds that `base` does not, as the value to merge over `base` again, with the dotted path of each
 * piece in the trail's `paths`: new keys whole, list items `base` lacks, scalars that differ. Undefined when there
 * is none.
 */
export function settingsExtras(have: unknown, base: unknown, trail: Trail): unknown {
  if (Array.isArray(have) && Array.isArray(base)) {
    const extra = have.filter((item) => !base.some((known) => isDeepStrictEqual(known, item)));
    if (extra.length === 0) return undefined;
    trail.paths.push(trail.at);
    return extra;
  }
  if (isRecord(have) && isRecord(base)) return objectExtras(have, base, trail);
  return isDeepStrictEqual(have, base) ? undefined : keep(have, trail);
}

/** The groups of one event's value cut down to the hooks that run a command `known` does not. */
function ownGroups(value: unknown, known: (command: string) => boolean): unknown[] {
  return (Array.isArray(value) ? value : [value]).flatMap((group: unknown) => {
    if (!isRecord(group) || !Array.isArray(group.hooks)) return [group];
    const unknown: unknown[] = group.hooks.filter(
      (hook: unknown) => !(isRecord(hook) && typeof hook.command === "string" && known(hook.command)),
    );
    return unknown.length > 0 ? [{ ...group, hooks: unknown }] : [];
  });
}

/**
 * The hooks of `hooks` (a settings file's `hooks` value) that run a command `known` does not: per event, the groups
 * cut down to their unknown hooks. `events` lists each carried event with its group count.
 */
export function ownHooks(hooks: unknown, known: (command: string) => boolean): OwnHooks {
  const carried: Record<string, unknown[]> = {};
  if (isRecord(hooks)) {
    for (const [event, value] of Object.entries(hooks)) {
      const groups = ownGroups(value, known);
      if (groups.length > 0) carried[event] = groups;
    }
  }
  return { events: Object.entries(carried).map(([event, groups]) => [event, groups.length]), hooks: carried };
}

/** Whether `have` has every key of `want` (recursively) and every list item of it. */
function covers(have: unknown, want: unknown): boolean {
  if (Array.isArray(want))
    return Array.isArray(have) && want.every((item) => have.some((known) => isDeepStrictEqual(known, item)));
  if (isRecord(want))
    return isRecord(have) && Object.entries(want).every(([key, value]) => key in have && covers(have[key], value));
  return isDeepStrictEqual(have, want);
}

/**
 * Whether `existing`, the file already at `to`, holds everything `content` would write there: the rule text, or every
 * key and list item.
 */
export function alreadyHolds(to: string, existing: string, content: string): boolean {
  if (to.endsWith(MD)) {
    // every markdown file a plan writes is a rule, which starts with the same frontmatter
    return existing.includes(content.slice(RULE_FRONTMATTER.length).trim());
  }
  try {
    return covers(JSON.parse(existing), JSON.parse(content));
  } catch {
    return false;
  }
}
