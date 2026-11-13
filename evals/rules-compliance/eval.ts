import { join } from "node:path";

import { firstLineIs } from "../../cli/eval/first-line-is.ts";
import { defineEval, type EvalSpec } from "../../cli/eval/spec.ts";
import { cases } from "./cases.ts";
import { rulesSystem } from "./rules-system.ts";

/** Room for one step name and nothing more. */
const MAX_TOKENS = 16;

const spec: EvalSpec = defineEval({
  cases: cases.map(({ expect, ...rest }) => ({ ...rest, pass: firstLineIs(expect) })),
  // The system text is the rules and the scope page, built with parseDoc; the runner and grader live in cli/eval.
  files: ["agents/rules/overview.md", "references/scope.md", "cli/eval", "cli/sync/agents/frontmatter.ts"],
  maxTokens: MAX_TOKENS,
  model: "claude-haiku-5-5",
  system: rulesSystem(join(import.meta.dirname, "..", "..")),
});

export default spec;
