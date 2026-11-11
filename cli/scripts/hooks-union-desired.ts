/** What the union wants in each hook file, from the scripts the consumer has and the repo hooks the source ships. */
import fs from "node:fs";
import path from "node:path";

import { HOOK_SCRIPTS, type HookName } from "./hook-command.ts";
import { BEHIND, MAP, NAMED_EXTRAS, POST_EXTRAS, SESSION_EXTRAS } from "./hooks-union-commands.ts";
import { loadJson } from "./hooks-union-merge.ts";
import {
  AUTORUN_NEEDLES,
  BEHIND_SCRIPT,
  MAP_TIMEOUT_S,
  POST_WRITE_MATCHER,
  PRE_WRITE_MATCHER,
} from "./hooks-union.constants.ts";
import type { HookEntry, HookGroup, NamedHook, Roots } from "./hooks-union.types.ts";

/** Consumer-owned extras live in the consumer's root `scripts/`. */
function hasScript(root: string, name: string): boolean {
  return fs.existsSync(path.join(root, "scripts", name));
}

/** A repo hook ships while its script is copied into `cli/scripts/`. */
export function ships(src: string, name: HookName): boolean {
  return fs.existsSync(path.join(src, "cli", "scripts", HOOK_SCRIPTS[name]));
}

/** The consumer's path deny from `.repo/permissions.json`, without write-path rules. */
export function loadConsumerDeny({ consumer }: Roots): string[] {
  const data = loadJson(path.join(consumer, ".repo", "permissions.json"));
  if (!Array.isArray(data.deny)) return [];
  return data.deny.filter((x): x is string => typeof x === "string" && !x.startsWith("Write("));
}

export function presentAutorun(root: string): string[] {
  return AUTORUN_NEEDLES.filter((n) => hasScript(root, n));
}

function hookCmd(command: string, timeout?: number): HookEntry {
  const h: HookEntry = { command, type: "command" };
  if (timeout != null) h.timeout = timeout;
  return h;
}

export function desiredPre(root: string, writeMatcher: string = PRE_WRITE_MATCHER): HookGroup[] {
  return hasScript(root, BEHIND_SCRIPT) ? [{ hooks: [hookCmd(BEHIND)], matcher: writeMatcher }] : [];
}

export function mapHooks(src: string): HookName[] {
  return ships(src, "session-map") ? ["session-map"] : [];
}

/** The SessionStart hooks, the folder map first; `map: false` for hosts whose generator writes the map entry itself. */
export function sessionHooks({ src, consumer }: Roots, { map = true }: { map?: boolean } = {}): HookEntry[] {
  const first = map && ships(src, "session-map") ? [hookCmd(MAP, MAP_TIMEOUT_S)] : [];
  const extras = SESSION_EXTRAS.filter(([script]) => hasScript(consumer, script)).map(([, cmd]) => hookCmd(cmd));
  return [...first, ...extras];
}

export function desiredPost(root: string, matcher: string = POST_WRITE_MATCHER): HookGroup[] | null {
  const hooks = POST_EXTRAS.filter(([script]) => hasScript(root, script)).map(([, cmd]) => hookCmd(cmd));
  return hooks.length ? [{ hooks, matcher }] : null;
}

export function consumerNamed(root: string): Record<string, NamedHook> {
  return Object.fromEntries(NAMED_EXTRAS.filter((e) => hasScript(root, e.script)).map((e) => [e.name, e.hook]));
}
