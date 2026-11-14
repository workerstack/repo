/** The strategy domain's values, approval-block items and approval replies. */

/** Who runs a plan's leaves: the parent itself, or spawned fast or deep implementers. */
export type Strategy = "free" | "spawn-fast" | "spawn-deep";

/** A strategy that spawns implementers. */
export type SpawnStrategy = Exclude<Strategy, "free">;

/** Whether the session asks the user its questions or decides them and runs on. */
export type Approval = "ask" | "away";

/** How much process a change gets when no skill is named: the fast or the deep plan skills. */
export type Effort = "fast" | "deep";

/**
 * What an approval block can name: a full plan or roadmap, with its strategy and its advice (null when the file has
 * none), or a fast plan or roadmap, which have neither.
 */
export type ItemKind = "plan" | "roadmap" | "fast-plan" | "fast-roadmap";

export type Approvable =
  | { kind: "plan" | "roadmap"; serial: number; strategy: Strategy; advice: string | null }
  | { kind: "fast-plan" | "fast-roadmap"; serial: number };

export type ApprovalReply =
  | { kind: "approve"; strategy: Strategy | null }
  | { kind: "handoff"; strategy: Strategy | null }
  | { kind: "unknown"; word: string };

export type ApprovalAction = "approve" | "handoff";

/** The kinds of plan a review stamp points at. */
export type ReviewKind = "plan" | "fast-plan";

/** A stamped plan whose own frontmatter says in-progress with a spawn strategy. */
export type ActiveReview = { kind: ReviewKind; plan: string; serial: number; strategy: SpawnStrategy };
