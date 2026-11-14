/** The deny a parent's product write gets while the session reviews one or more spawn plans. */
import { implementerOf } from "./strategy.ts";
import type { ActiveReview } from "./strategy.types.ts";

/** `a`, `a and b`, `a, b and c`. */
function joinAnd(parts: string[]): string {
  const rest = [...parts];
  const last = String(rest.pop());

  return rest.length === 0 ? last : `${rest.join(", ")} and ${last}`;
}

/** How the deny names a review: `plan 3` or `fast-plan 4`. */
function nameOf(review: ActiveReview): string {
  return `${review.kind} ${review.serial}`;
}

/**
 * The deny naming each running review, in the order given. One review keeps the one-plan text; several name the
 * implementer for each.
 */
export function reviewDenyReason(reviews: [ActiveReview, ...ActiveReview[]]): string {
  const runs = `${joinAnd(reviews.map((r) => `${nameOf(r)} runs strategy ${r.strategy}`))}: this session reviews.`;
  const [first] = reviews;

  if (reviews.length === 1) {
    return (
      `${runs} Spawn ${implementerOf(first.strategy, 1)} for product writes; ` +
      "the plan, the journal and .repo/ work dirs stay writable."
    );
  }

  const spawns = joinAnd(reviews.map((r) => `${implementerOf(r.strategy, 1)} for ${nameOf(r)}`));

  return `${runs} Spawn ${spawns}; the plans, the journals and .repo/ work dirs stay writable.`;
}
