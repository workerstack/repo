/** What a job prints and the exit code it ends with; `fallback` tells the caller to run the plain command instead. */
export type JobResult = {
  fallback: boolean;
  text: string;
  code: number;
};

/** The parsed `job.ts` command line. */
export type ParsedArgs = {
  job: string;
  query: string;
  path: string;
  glob: string[];
  cwd: string;
  stash: string;
  from: string;
  to: string;
  unknown: boolean;
};

/** The facts `formatFacts` prints as the short verdict of one job. */
export type FactsInput = {
  kind?: string;
  n?: number;
  facts?: string[];
  errors?: string[];
  failed?: boolean;
  stash?: string;
  truncated?: boolean;
};

/** Where a job runs (`cwd`) and where its stash lives (`root`). */
export type StashRoots = {
  cwd?: string | undefined;
  root?: string | undefined;
};

/** Where a search starts (`path`, under the cwd) and the file globs it keeps. */
export type SearchOptions = {
  path?: string | undefined;
  glob?: string[] | string | undefined;
} & StashRoots;

/** The stash a slice reads, the text its lines must hold (`path`) and its line range. */
export type SliceOptions = {
  stash?: string | undefined;
  path?: string | undefined;
  from?: string | number | null | undefined;
  to?: string | number | null | undefined;
} & StashRoots;

/** A fetch's roots and how long it may take. */
export type FetchOptions = {
  timeoutMs?: number;
} & StashRoots;

/** Every option of any job, with the job and its query. */
export type JobOptions = {
  job?: string | undefined;
  query?: string | undefined;
  unknown?: boolean | undefined;
} & SearchOptions &
  SliceOptions;

/** One output line and its index. */
export type SqueezeItem = {
  l: string;
  i: number;
};

/** One output line with its rank. */
export type RankedItem = {
  sc: number;
} & SqueezeItem;

/** The lines `squeezLines` keeps so far, from all of them ranked. */
export type Picking = {
  ranked: RankedItem[];
  kept: RankedItem[];
  used: Set<number>;
};

/** What a line is ranked against: the query as a pattern or text, and the last index. */
export type RankContext = {
  queryRe: RegExp | null;
  q: string;
  last: number;
};

/** The lines of one job's output and where to stash them when they are too many. */
export type VerdictInput = {
  kind: string;
  lines: string[];
  raw: string;
  query: string;
  cwd: string | undefined;
  root: string | undefined;
  /** Set for a failed command: these lines are the verdict's errors. */
  errors?: string[];
  truncated?: boolean;
};

/** A stash's root and the cwd its printed path is relative to. */
export type StashPlace = {
  root: string;
  cwd: string;
};

/** One flag's value and the index the scan goes on from. */
export type FlagValue = {
  value: string;
  next: number;
};

/** Where a node search runs: the root hits are relative to, the file or dir it starts at and its globs. */
export type SearchScope = {
  cwd: string;
  start: string;
  glob: string[];
};

/** A node search under way: its pattern, the hits so far and their bytes. */
export type SearchState = {
  query: string;
  re: RegExp | null;
  facts: string[];
  n: number;
  bytes: number;
} & SearchScope;

/** What a search found: the hit count, the facts and whether it stopped at a limit. */
export type SearchHits = {
  n: number;
  facts: string[];
  truncated: boolean;
};
