import { join } from "node:path";

import { defineEval, type EvalSpec } from "../../cli/eval/spec.ts";
import { cases } from "./cases.ts";
import { routesTo } from "./routes-to.ts";
import { skillSystem } from "./skill-system.ts";

/** Room for one skill name and nothing more. */
const MAX_TOKENS = 16;

const spec: EvalSpec = defineEval({
  cases: cases.map(({ expect, ...rest }) => ({ ...rest, pass: routesTo(expect) })),
  maxTokens: MAX_TOKENS,
  model: "claude-haiku-5-5",
  system: skillSystem(join(import.meta.dirname, "..", "..", "agents", "skills")),
});

export default spec;
