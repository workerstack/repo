/** Renames the saved session `mode:` to `approval:` in the frontmatter of plans and roadmaps, `auto` becoming `ask`. */
import { REPO } from "../repo-dirs.ts";
import { byCodeUnit } from "./by-code-unit.ts";
import { APPROVAL_DIRS, modeLineRe, OLD_AUTO } from "./migrate-approval-name.constants.ts";
import { LEADING_FRONTMATTER } from "./migrate-strategy-name.constants.ts";
import { changedMarkdown } from "./migrate-strategy-name.ts";
import type { MigrationStep } from "./migrate.ts";

/** `text` with `mode: X` in its leading frontmatter replaced by `approval: X`, `auto` by `ask`; the rest as it was. */
export function renameApproval(text: string): string {
  const front = LEADING_FRONTMATTER.exec(text)?.[0];

  if (front === undefined) return text;

  return (
    front.replaceAll(modeLineRe(), (_line, value: string) => `approval: ${value === OLD_AUTO ? "ask" : value}`) +
    text.slice(front.length)
  );
}

/** The one step that renames `mode:` in each plan and roadmap that has it; none otherwise. */
export function planApprovalRename(root: string): MigrationStep[] {
  const paths = APPROVAL_DIRS.flatMap((name) => changedMarkdown({ dirName: name, root }, renameApproval)).toSorted(
    byCodeUnit,
  );

  if (paths.length === 0) return [];
  const count = `${paths.length} file${paths.length === 1 ? "" : "s"}`;

  return [
    {
      kind: "rename-text",
      note: `renamed mode to approval in ${count} under ${REPO}`,
      paths,
      rename: "approval",
    },
  ];
}
