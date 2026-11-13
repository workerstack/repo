import { tempDir, write } from "./planted-repo.ts";

/** The bytes of a shipped context tree: the rules, the skill descriptions and the index. */
export type Sizes = { rules: number; skills: number; index: number };

/** A temp dir holding a tree of exactly `sizes` bytes per bucket, plus files no bucket counts. */
export function contextTree(sizes: Sizes, extra: Record<string, unknown> = {}): string {
  const dir = tempDir();
  write(dir, {
    "agents/rules/overview.md": "r".repeat(sizes.rules),
    "agents/rules/notes.txt": "not counted",
    "agents/skills/one/SKILL.md": `---\nname: one\ndescription: ${"s".repeat(sizes.skills)}\n---\nthe body is not counted\n`,
    "references/INDEX.md": "i".repeat(sizes.index),
    ...extra,
  });

  return dir;
}

/** A reader of main's files out of a map; a file the map lacks reads as absent. */
export function mainOf(files: Record<string, string>): (rel: string) => string | null {
  return (rel) => files[rel] ?? null;
}

/** The text of a budget file. */
export function budgetText(sizes: Sizes): string {
  return `${JSON.stringify(sizes, null, 2)}\n`;
}

export const BUDGET = "context-budget.json";
export const LEDGER = ".repo/context-growth.jsonl";

/** A budget a checkout holds, and main's smaller one. */
export const HERE: Sizes = { index: 300, rules: 6100, skills: 200 };
export const MAIN: Sizes = { index: 300, rules: 5739, skills: 200 };

/** A reader of main's files whose budget is `sizes`. */
export function mainWith(sizes: Sizes): (rel: string) => string | null {
  return mainOf({ [BUDGET]: budgetText(sizes) });
}
