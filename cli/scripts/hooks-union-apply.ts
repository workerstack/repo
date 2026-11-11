/** The union's write for each host's hook file. */
import path from "node:path";

import { isRecord } from "./hook-input.ts";
import { consumerNamed, desiredPost, desiredPre, loadConsumerDeny, sessionHooks } from "./hooks-union-desired.ts";
import { flatEntries, flatSession, loadJson, saveJson, uniq, upsertGroups } from "./hooks-union-merge.ts";
import {
  AGENTS_HOOKS,
  AGY_WRITE_MATCHER,
  CLAUDE_SETTINGS,
  CODEX_HOOKS,
  CURSOR_HOOKS,
  CURSOR_WRITE_MATCHER,
} from "./hooks-union.constants.ts";
import type { JsonObject, Roots } from "./hooks-union.types.ts";

/** Claude's permissions with the live deny kept, minus write-path rules, plus the consumer's deny. */
function claudePermissions(live: JsonObject, roots: Roots): JsonObject {
  const permissions = isRecord(live.permissions) ? { ...live.permissions } : {};
  const liveDeny: unknown[] = Array.isArray(permissions.deny) ? permissions.deny : [];
  permissions.deny = uniq([
    ...liveDeny.filter((x: unknown) => typeof x !== "string" || !x.startsWith("Write(")),
    ...loadConsumerDeny(roots),
  ]);
  return permissions;
}

export function applyClaude(roots: Roots): void {
  const root = roots.consumer;
  const abs = path.join(roots.ws, CLAUDE_SETTINGS);
  const live = loadJson(abs);
  const hooks = isRecord(live.hooks) ? { ...live.hooks } : {};
  hooks.PreToolUse = upsertGroups(hooks.PreToolUse, desiredPre(root));
  const session = sessionHooks(roots);
  if (session.length > 0) hooks.SessionStart = [{ hooks: session }];
  const post = desiredPost(root);
  if (post !== null) hooks.PostToolUse = upsertGroups(hooks.PostToolUse, post);
  saveJson(abs, { ...live, hooks, permissions: claudePermissions(live, roots) });
}

export function applyCodex(roots: Roots): void {
  const root = roots.consumer;
  const abs = path.join(roots.ws, CODEX_HOOKS);
  const live = loadJson(abs);
  const liveHooks = isRecord(live.hooks) ? live.hooks : null;
  const cur: JsonObject = liveHooks === null ? { ...live } : { ...liveHooks };
  cur.PreToolUse = upsertGroups(cur.PreToolUse, desiredPre(root));
  const session = sessionHooks(roots);
  if (session.length > 0) cur.SessionStart = [{ hooks: session }];
  const post = desiredPost(root);
  if (post !== null) {
    cur.PostToolUse = upsertGroups(
      cur.PostToolUse,
      post.map((g) => ({ hooks: g.hooks })),
    );
  }
  saveJson(abs, liveHooks === null ? { ...live, ...cur } : { ...live, hooks: cur });
}

export function applyCursor(roots: Roots): void {
  const root = roots.consumer;
  const abs = path.join(roots.ws, CURSOR_HOOKS);
  const live = loadJson(abs);
  const hooks = isRecord(live.hooks) ? { ...live.hooks } : {};
  hooks.preToolUse = upsertGroups(hooks.preToolUse, flatEntries(desiredPre(root, CURSOR_WRITE_MATCHER)));
  const session = sessionHooks(roots, { map: false });
  if (session.length > 0) hooks.sessionStart = flatSession(hooks.sessionStart, session);
  const post = desiredPost(root, CURSOR_WRITE_MATCHER);
  if (post !== null) hooks.postToolUse = upsertGroups(hooks.postToolUse, flatEntries(post));
  saveJson(abs, { version: 1, ...live, hooks });
}

export function applyAgents(roots: Roots): void {
  const root = roots.consumer;
  const abs = path.join(roots.ws, AGENTS_HOOKS);
  const live = loadJson(abs);
  const rulesync = isRecord(live.rulesync) ? { ...live.rulesync } : {};
  rulesync.PreToolUse = upsertGroups(rulesync.PreToolUse, desiredPre(root, AGY_WRITE_MATCHER));
  const session = sessionHooks(roots, { map: false });
  if (session.length > 0) rulesync.SessionStart = flatSession(rulesync.SessionStart, session);
  const post = desiredPost(root, AGY_WRITE_MATCHER);
  if (post !== null) rulesync.PostToolUse = post;
  saveJson(abs, { ...live, ...consumerNamed(root), rulesync });
}
