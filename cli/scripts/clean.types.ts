import type fs from "node:fs";

/** One path planned for removal; `kind` picks its line in the report. */
export interface RemoveItem {
  path: string;
  kind: string;
}

/** One path kept; nested dirs also name the durable dir that holds files. */
export interface KeepItem {
  path: string;
  kind: string;
  holds?: string;
}

/** What `cleanPlan` decided: the paths to remove and what was kept, by kind. */
export interface CleanPlan {
  remove: RemoveItem[];
  keep: KeepItem[];
}

/** One `repo clean` sweep: where, at what time, which sessions are live, and where the report goes. */
export interface CleanRun {
  root: string;
  now: number;
  liveSessions: Set<string>;
  dryRun: boolean;
  out: (line: string) => void;
  /** The delete edge; tests pass a failing one. */
  rm?: typeof fs.rmSync;
}

/** What `cleanPlan` plans from: the root, the time, the live sessions and the nested .tmp/repo dirs. */
export interface PlanInput {
  root: string;
  now: number;
  liveSessions: Set<string>;
  nested?: string[];
}

/** How each repo-owned dir under .tmp/repo is cleaned. */
export type Policy = "age-done" | "age" | "keep" | "per-session" | "per-stamp" | "per-receipt";

/** A plan under way: its time, live sessions, pinned plans, the newest artifact and the lists so far. */
export interface PlanState extends CleanPlan {
  now: number;
  liveSessions: Set<string>;
  pinned: Set<string>;
  artifactKeeper: string | null;
}

/** One entry's verdict: removed as `kind` when `gone`, else kept as `keptAs`. */
export interface Decision {
  path: string;
  gone: boolean;
  kind: string;
  keptAs: string;
}

/** One dir entry aged against its dir's policy: the dir name, the entry, its path and the dir's newest serial. */
export interface AgedEntry {
  name: string;
  entry: string;
  child: string;
  keeper: string | null;
}

/** What `repo clean --build` and `--deps` run with. */
export interface BuildRun {
  root: string;
  deps: boolean;
  dryRun: boolean;
  names: readonly string[];
  out: (line: string) => void;
  rm?: typeof fs.rmSync | undefined;
}
