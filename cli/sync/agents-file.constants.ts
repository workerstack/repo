/** The file every host reads, at the root and in each workspace package. */
export const AGENTS_FILE = "AGENTS.md";

/** The region of `AGENTS.md` sync writes: the stock pathless rules, `## Rules by path` and a package's pointer. */
export const RULES_REGION = "rules";

/** The bytes in a KiB, for the budget and the size the warning prints. */
export const KIB = 1024;

/** How many KiB of always-on text the root `AGENTS.md` may hold before sync warns; every session reads all of it. */
export const ALWAYS_ON_BUDGET_KIB = 12;

/** The decimals the warning prints a KiB size with. */
export const KIB_DECIMALS = 1;
