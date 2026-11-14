/** Renames the old strategies `review-fast`, `review-deep` and `default` to `spawn-fast`, `spawn-deep` and `free`. */
import fs from "node:fs";
import path from "node:path";

import { REPO } from "../repo-dirs.ts";
import { byCodeUnit } from "./by-code-unit.ts";
import { isDir } from "./migrate-fs.ts";
import { frontmatterRe, handoffFreeRe, handoffRe, LEADING_FRONTMATTER } from "./migrate-strategy-name.constants.ts";
import type { MigrationStep } from "./migrate.ts";

/** Where a file keeps its strategy: a plan or roadmap in its frontmatter, a handoff in a parenthesised mention. */
export type StrategyKind = "doc" | "handoff";

/** The dirs under `.repo` whose `.md` files are renamed, and what kind each is. */
const DIRS: readonly { dir: string; kind: StrategyKind }[] = [
  { dir: "plans", kind: "doc" },
  { dir: "roadmaps", kind: "doc" },
  { dir: "handoffs", kind: "handoff" },
];

/** The replacement of one match: its head kept, the speed behind `spawn-`, or `free` for the old `default`. */
function swap(_all: string, head: string, speed: string | undefined): string {
  return speed === undefined ? `${head}free` : `${head}spawn-${speed}`;
}

/** `text` with the old strategy names replaced; the rest, and any `spawn-*` value, as it was. */
export function renameStrategies(text: string, kind: StrategyKind): string {
  if (kind === "handoff") return text.replaceAll(handoffRe(), swap).replaceAll(handoffFreeRe(), "$1free");
  const front = LEADING_FRONTMATTER.exec(text)?.[0];

  if (front === undefined) return text;

  return front.replaceAll(frontmatterRe(), swap) + text.slice(front.length);
}

/** `abs` relative to `root`, joined with `/` whatever the platform separator of `p`. */
export function relativeSlash(root: string, abs: string, p: typeof path): string {
  return p.relative(root, abs).split(p.sep).join("/");
}

/** The `.md` files directly under `<root>/.repo/<dir>`, sorted, whose text the rename changes. */
function changed(root: string, entry: (typeof DIRS)[number], p: typeof path): string[] {
  const dir = p.join(root, REPO, entry.dir);

  if (!isDir(dir)) return [];

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((file) => file.isFile() && file.name.endsWith(".md"))
    .map((file) => p.join(dir, file.name))
    .filter((file) => {
      const text = fs.readFileSync(file, "utf8");

      return renameStrategies(text, entry.kind) !== text;
    })
    .map((file) => relativeSlash(root, file, p))
    .toSorted(byCodeUnit);
}

/** The one step that renames the old strategies in each plan, roadmap and handoff that has them; none otherwise. */
export function planStrategyRename(root: string, p: typeof path = path): MigrationStep[] {
  const paths = DIRS.flatMap((entry) => changed(root, entry, p)).toSorted(byCodeUnit);

  if (paths.length === 0) return [];
  const count = `${paths.length} file${paths.length === 1 ? "" : "s"}`;

  return [
    {
      kind: "rename-text",
      note:
        `renamed strategy review-fast to spawn-fast, review-deep to spawn-deep and default to free in ${count} ` +
        `under ${REPO}`,
      paths,
      rename: "strategy",
    },
  ];
}

/** The kind of the file at root-relative `rel`: handoffs under `.repo/handoffs`, everything else a doc. */
export function kindOf(rel: string): StrategyKind {
  return rel.startsWith(`${REPO}/handoffs/`) ? "handoff" : "doc";
}
