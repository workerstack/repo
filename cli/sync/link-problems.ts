import fs from "node:fs";
import path from "node:path";

import { ANCHOR, FENCED_CODE, INLINE_CODE, MARKDOWN_LINK, URL_SCHEME } from "./repo-dir.constants.ts";

/** One markdown file to check: its root-relative path, its text, and the dir under `root` its links resolve from. */
export type LinkSource = { root: string; rel: string; text: string; base: string };

/** One line per relative link of the source's text that points at nothing, resolved from its `base` under `root`. */
export function linkProblems({ root, rel, text, base }: LinkSource): string[] {
  const prose = text.replaceAll(FENCED_CODE, "").replaceAll(INLINE_CODE, "");
  const problems: string[] = [];
  for (const match of prose.matchAll(MARKDOWN_LINK)) {
    // The target group is not optional, so every match holds it.
    const bare = String(match.groups?.target).replace(ANCHOR, "");
    if (bare === "" || bare.startsWith("/") || URL_SCHEME.test(bare)) continue;
    if (!fs.existsSync(path.join(root, base, bare))) problems.push(`${rel}: link ${bare} does not exist`);
  }
  return problems;
}
