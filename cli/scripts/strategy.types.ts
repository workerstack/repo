/** The strategy domain's values, approval-block items and approval replies. */

export type Strategy = "default" | "spawn-fast" | "spawn-deep";

export type SpawnStrategy = Exclude<Strategy, "default">;

export type Mode = "ask" | "auto" | "away";

/** What an approval block can name: a full plan or roadmap, with its strategy, or a fast plan, which has none. */
export type ItemKind = "plan" | "roadmap" | "fast-plan";

export type Approvable =
  | { kind: "plan" | "roadmap"; serial: number; strategy: Strategy }
  | { kind: "fast-plan"; serial: number };

export type Approval =
  | { kind: "approve"; strategy: Strategy | null }
  | { kind: "handoff"; strategy: Strategy | null }
  | { kind: "unknown"; word: string };

export type ApprovalAction = "approve" | "handoff";

export type ActiveReview = { plan: string; serial: number; strategy: SpawnStrategy };
