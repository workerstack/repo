import { join } from "node:path";

import { firstWordIs } from "../../cli/eval/first-word-is.ts";
import { defineEval, type EvalSpec } from "../../cli/eval/spec.ts";
import { cases } from "./cases.ts";
import { rulesSystem } from "./rules-system.ts";

/** Samples a case gets: sonnet bills 20x haiku, and 3 would bound over the $1.00 cap. */
const SAMPLES = 2;

/** Room for one step name and nothing more. */
const MAX_TOKENS = 16;

const spec: EvalSpec = defineEval({
  cases: cases.map(({ expect, ...rest }) => ({ ...rest, pass: firstWordIs(expect) })),
  // The system text is the rules and the scope page, built with parseDoc; the runner and grader live in cli/eval.
  files: ["agents/rules/overview.md", "references/scope.md", "cli/eval", "cli/sync/agents/frontmatter.ts"],
  maxTokens: MAX_TOKENS,
  model: "claude-sonnet-5-5",
  samples: SAMPLES,
  system: rulesSystem(join(import.meta.dirname, "..", "..")),
});

export default spec;
