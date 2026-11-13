import { join } from "node:path";

import { firstWordIs } from "../../cli/eval/first-word-is.ts";
import { defineEval, type EvalSpec } from "../../cli/eval/spec.ts";
import { cases } from "./cases.ts";
import { skillSystem } from "./skill-system.ts";

/** Room for one skill name and nothing more. */
const MAX_TOKENS = 16;

const spec: EvalSpec = defineEval({
  cases: cases.map(({ expect, ...rest }) => ({ ...rest, pass: firstWordIs(expect) })),
  // Every case sends every skill description, so any skill edit can move any route.
  files: ["agents/skills", "cli/eval", "cli/sync/agents/frontmatter.ts"],
  maxTokens: MAX_TOKENS,
  model: "claude-haiku-5-5",
  system: skillSystem(join(import.meta.dirname, "..", "..", "agents", "skills")),
});

export default spec;
