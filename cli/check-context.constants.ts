/** The names the shipped-context budget check shares. */

/** The measured budget, committed at the root; its presence turns the check on. */
export const BUDGET_PATH = "context-budget.json";

/** One line per accepted rise over main, committed so a rebase merges it. */
export const LEDGER_PATH = ".repo/context-growth.jsonl";

/** Where each bucket's bytes come from. */
export const RULES_DIR = "agents/rules";
export const RULES_EXT = ".md";
export const SKILLS_DIR = "agents/skills";
export const SKILL_FILE = "SKILL.md";
export const INDEX_PATH = "references/INDEX.md";

/** The buckets, in the order the budget file lists them. */
export const BUCKETS = ["index", "rules", "skills"] as const;

export const WRITE_FLAG = "--write";
export const REASON_FLAG = "--reason";

export const STALE = "context: context-budget.json is stale: run bun repo check --write";

export function riseMessage(bucket: string, from: number, to: number): string {
  const rise = `${bucket} ${from} -> ${to} bytes (+${to - from})`;

  return `context: ${rise} over main; record it: bun repo check --write --reason "<why>"`;
}

export function needsReason(rises: string[]): string {
  return `--reason is required for a rise over main (${rises.join(", ")})`;
}

export function written(added: number): string {
  return `context-budget.json written; .repo/context-growth.jsonl +${added} line(s)`;
}

/** What `indexOf` answers for no match. */
export const NOT_FOUND = -1;

/** The spaces a JSON file here is indented by. */
export const JSON_INDENT = 2;
