import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseDoc } from "../../cli/sync/agents/frontmatter.ts";

const RULES = "agents/rules/overview.md";
const SCOPE = "references/scope.md";

const STEPS = `You are in the main checkout of this repo, on the default branch.
Reply with only the first step you would take for the user's message:
- plan: write a plan and wait for approval
- worktree: make a worktree, then change files there
- edit: change files here now
- answer: reply without changing any file`;

/** The body of the repo file `rel` under `root`, below its frontmatter. */
function body(root: string, rel: string): string {
  return parseDoc(rel, readFileSync(join(root, rel), "utf8")).body;
}

/** The system prompt an agent in the repo at `root` starts with: the rules as AGENTS.md, the scope page, the steps. */
export function rulesSystem(root: string): string {
  return [
    `Contents of AGENTS.md:\n\n${body(root, RULES)}`,
    `Contents of node_modules/@workerstack/repo/${SCOPE}:\n\n${body(root, SCOPE)}`,
    STEPS,
  ].join("\n\n");
}
