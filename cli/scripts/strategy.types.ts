/** The strategy domain's values, closing-line items and approval replies. */

export type Strategy = "default" | "review-fast" | "review-deep";

export type ReviewStrategy = Exclude<Strategy, "default">;

export type Mode = "ask" | "auto" | "away";

export type Approvable = { kind: "plan" | "roadmap"; serial: number; strategy: Strategy };

export type Approval =
  | { kind: "approve"; strategy: Strategy | null }
  | { kind: "handoff"; strategy: Strategy | null }
  | { kind: "unknown"; word: string };

export type ActiveReview = { plan: string; serial: number; strategy: ReviewStrategy };
