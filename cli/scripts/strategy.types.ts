/** The strategy domain's values, approval-block items and approval replies. */

export type Strategy = "free" | "spawn-fast" | "spawn-deep";

export type SpawnStrategy = Exclude<Strategy, "free">;

export type Mode = "ask" | "away";

/**
 * What an approval block can name: a full plan or roadmap, with its strategy, or a fast plan or roadmap, which have
 * none.
 */
export type ItemKind = "plan" | "roadmap" | "fast-plan" | "fast-roadmap";

export type Approvable =
  | { kind: "plan" | "roadmap"; serial: number; strategy: Strategy }
  | { kind: "fast-plan" | "fast-roadmap"; serial: number };

export type Approval =
  | { kind: "approve"; strategy: Strategy | null }
  | { kind: "handoff"; strategy: Strategy | null }
  | { kind: "unknown"; word: string };

export type ApprovalAction = "approve" | "handoff";

export type ActiveReview = { plan: string; serial: number; strategy: SpawnStrategy };
