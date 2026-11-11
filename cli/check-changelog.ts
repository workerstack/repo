import fs from "node:fs";
import path from "node:path";

import { changelogFormatProblems } from "./release/changelog.ts";
import { CHANGELOG_FILE } from "./release/release.constants.ts";
import { ownerLookup } from "./tdd-scope.ts";

/** The `repo check` lines for the root's CHANGELOG.md; none for a private root or one without a readable manifest. */
export function checkChangelog(root: string): string[] {
  if (!ownerLookup(root)("package.json").public) return [];
  const file = path.join(root, CHANGELOG_FILE);
  return changelogFormatProblems(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);
}
