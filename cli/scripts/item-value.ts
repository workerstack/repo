/** The value a session's newest in-progress saved item holds, read from the approvals file the hook keeps. */
import fs from "node:fs";

import type { HookInput } from "./hook-input.ts";
import { kindAt } from "./orchestrate-reviews.ts";
import { approvalsFile, frontmatterOf, readLines } from "./orchestrate-session.ts";
import { IN_PROGRESS } from "./orchestrate.constants.ts";
import type { ItemKind } from "./orchestrate.types.ts";
import { canonicalPath, resolveRoots } from "./workspace-root.ts";

/**
 * What `pick` reads from the frontmatter of the newest in-progress item of a kind in `kinds` that this session saved;
 * null when none gives one. A path is matched to a kind after it is canonicalized.
 */
export function itemValue<T>(
  data: HookInput,
  pick: (fm: Record<string, string>) => T | null,
  kinds: readonly ItemKind[],
): T | null {
  const file = approvalsFile(data);
  const { root } = resolveRoots(data);

  for (const abs of file === null ? [] : readLines(file).toReversed()) {
    const kind = kindAt(canonicalPath(abs), root);

    if (kind === null || !kinds.includes(kind)) continue;

    try {
      const fm = frontmatterOf(fs.readFileSync(abs, "utf8"));
      const value = pick(fm);

      if (fm.status === IN_PROGRESS && value !== null) return value;
    } catch {
      // skip unreadable
    }
  }

  return null;
}
