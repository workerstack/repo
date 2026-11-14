/** Renames the saved session mode `auto` to `ask` in the frontmatter of plans and roadmaps. */
import { REPO } from "../repo-dirs.ts";
import { byCodeUnit } from "./by-code-unit.ts";
import { MODE_DIRS, modeAutoRe } from "./migrate-mode-name.constants.ts";
import { LEADING_FRONTMATTER } from "./migrate-strategy-name.constants.ts";
import { changedMarkdown } from "./migrate-strategy-name.ts";
import type { MigrationStep } from "./migrate.ts";

/** `text` with `mode: auto` in its leading frontmatter replaced by `mode: ask`; the rest as it was. */
export function renameMode(text: string): string {
  const front = LEADING_FRONTMATTER.exec(text)?.[0];

  if (front === undefined) return text;

  return front.replaceAll(modeAutoRe(), "mode: ask") + text.slice(front.length);
}

/** The one step that renames `mode: auto` in each plan and roadmap that has it; none otherwise. */
export function planModeRename(root: string): MigrationStep[] {
  const paths = MODE_DIRS.flatMap((name) => changedMarkdown({ dirName: name, root }, renameMode)).toSorted(byCodeUnit);

  if (paths.length === 0) return [];
  const count = `${paths.length} file${paths.length === 1 ? "" : "s"}`;

  return [{ kind: "rename-text", note: `renamed mode auto to ask in ${count} under ${REPO}`, paths, rename: "mode" }];
}
