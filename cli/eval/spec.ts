/** One prompt and the check on what the model answers; `control` cases are reported apart. */
export type EvalCase = {
  id: string;
  source: string;
  input: string;
  control?: boolean;
  pass: (output: string) => boolean;
};

/** What an eval file declares; the model, samples, maxTokens and files have defaults. */
export type EvalSpec = {
  model?: string;
  samples?: number;
  maxTokens?: number;
  system: string;
  cases: EvalCase[];
  /**
   * The repo-relative posix paths of the files and folders its system text and grader read, beyond `evals/<name>/`;
   * `repo eval --changed <base>` runs the eval only when one of them changed.
   */
  files?: string[];
};

/** A spec with every default applied. */
export type ResolvedEval = Required<EvalSpec>;

/** Types an eval file's default export. */
export function defineEval(spec: EvalSpec): EvalSpec {
  return spec;
}
