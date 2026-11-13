/** One prompt and the check on what the model answers; `control` cases are reported apart. */
export type EvalCase = {
  id: string;
  source: string;
  input: string;
  control?: boolean;
  pass: (output: string) => boolean;
};

/** What an eval file declares; the model, samples and maxTokens have defaults. */
export type EvalSpec = {
  model?: string;
  samples?: number;
  maxTokens?: number;
  system: string;
  cases: EvalCase[];
};

/** A spec with every default applied. */
export type ResolvedEval = Required<EvalSpec>;

/** Types an eval file's default export. */
export function defineEval(spec: EvalSpec): EvalSpec {
  return spec;
}
