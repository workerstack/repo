/** The folder under a checkout root that holds the agent files. */
export const REPO = ".repo";

/** Work docs that live at the top of `.repo`. */
export const WORK_DIRS = ["plans", "plans-fast", "roadmaps", "roadmaps-fast", "handoffs", "implementations"] as const;

/** Loose dumps and notes. */
export const SCRATCH = "scratch";

/** Machine state. */
export const STATE = "tmp";

/** The gitignored dirs under `.repo`; committed siblings such as `lessons` are not in it. */
export const IGNORED_DIRS: readonly [
  "plans",
  "plans-fast",
  "roadmaps",
  "roadmaps-fast",
  "handoffs",
  "implementations",
  "scratch",
  "tmp",
] = [...WORK_DIRS, SCRATCH, STATE];
