import type fs from "node:fs";

/** One path planned for removal; `kind` picks its line in the report. */
export type RemoveItem = {
  path: string;
  kind: string;
};

/** One path kept; nested dirs also name the durable dir that holds files. */
export type KeepItem = {
  path: string;
  kind: string;
  holds?: string;
};

/** What `cleanPlan` decided: the paths to remove and what was kept, by kind. */
export type CleanPlan = {
  remove: RemoveItem[];
  keep: KeepItem[];
};

/** One `repo clean` sweep: where, at what time, which sessions are live, and where the report goes. */
export type CleanRun = {
  root: string;
  now: number;
  liveSessions: Set<string>;
  dryRun: boolean;
  out: (line: string) => void;
  /** The delete edge; tests pass a failing one. */
  rm?: typeof fs.rmSync;
};

/** What `cleanPlan` plans from: the root, the time, the live sessions and the nested ignored `.repo` dirs. */
export type PlanInput = {
  root: string;
  now: number;
  liveSessions: Set<string>;
  nested?: string[];
};

/** How each ignored dir under `.repo` is cleaned: `loose` is scratch, `state` is tmp. */
export type Policy = "age-done" | "age" | "keep" | "loose" | "state" | "per-session" | "per-stamp" | "per-receipt";

/** A plan under way: its time, live sessions, pinned plans, the newest artifact and the lists so far. */
export type PlanState = {
  now: number;
  liveSessions: Set<string>;
  pinned: Set<string>;
  artifactKeeper: string | null;
} & CleanPlan;

/** One entry's verdict: removed as `kind` when `gone`, else kept as `keptAs`. */
export type Decision = {
  path: string;
  gone: boolean;
  kind: string;
  keptAs: string;
};

/** One dir entry aged against its dir's policy: the dir name, the entry, its path and the dir's newest serial. */
export type AgedEntry = {
  name: string;
  entry: string;
  child: string;
  keeper: string | null;
};

/** What `repo clean --build` and `--deps` run with. */
export type BuildRun = {
  root: string;
  deps: boolean;
  dryRun: boolean;
  names: readonly string[];
  out: (line: string) => void;
  /** Removes one planned path and what is under it; tests pass a failing one. */
  rm?: ((target: string) => void) | undefined;
};
