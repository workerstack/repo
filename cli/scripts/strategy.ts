/**
 * The strategy domain: how a plan or roadmap gets implemented, and the things that follow from it.
 *
 *   mode  how a session handles a question: ask or away
 *
 * The session's review stamps live in `review-stamps.ts`; the approval block and approval replies in
 * `closing-line.ts`.
 */
import { IMPLEMENTER_DEEP, IMPLEMENTER_FAST, APPROVALS, SPAWN_FAST, STRATEGIES } from "./strategy.constants.ts";
import type { Approvable, ItemKind, Approval, SpawnStrategy, Strategy } from "./strategy.types.ts";

/** True for a kind that has a strategy: a full plan or roadmap. A fast plan or fast roadmap has none. */
export function kindHasStrategy(kind: ItemKind): kind is "plan" | "roadmap" {
  return kind === "plan" || kind === "roadmap";
}

/** True for an item that has a strategy; the one guard every caller uses instead of testing a kind. */
export function hasStrategy<T extends Approvable>(item: T): item is Extract<T, { strategy: Strategy }> {
  return kindHasStrategy(item.kind);
}

export function parseApprovalSetting(v: string | undefined): Approval | null {
  return APPROVALS.find((m) => m === v) ?? null;
}

export function parseStrategy(v: string | undefined): Strategy | null {
  return STRATEGIES.find((s) => s === v) ?? null;
}

/** The implementer agent for a spawn strategy. spawn-fast starts fast and escalates; there is no attempt 3. */
export function implementerOf(s: SpawnStrategy, attempt: 1 | 2): typeof IMPLEMENTER_FAST | typeof IMPLEMENTER_DEEP {
  return s === SPAWN_FAST && attempt === 1 ? IMPLEMENTER_FAST : IMPLEMENTER_DEEP;
}
