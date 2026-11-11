/** Shared setup for the scrub-spawn-prompt suites: roots, the filler prompt and the hook-output reader. */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scrubText } from "../scrub-text-lib.ts";
import { resolveRoots } from "../workspace-root.ts";

/** `cli/scripts`, where the transcript fixtures live under `fixtures/`. */
export const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const root = path.resolve(here, "..", "..");
// Plans live in the main checkout's .tmp even when this suite runs in a worktree.
export const plansRoot = resolveRoots({ workspaceRoot: root }).root;

export const FILLER_PROMPT = "please can you make me a counter app, thanks";
export const scrubbedPrompt = scrubText(FILLER_PROMPT);

export type HookOut = {
  decision?: string;
  reason?: string;
  hookSpecificOutput?: { hookEventName?: string; updatedInput?: unknown };
};

export function parseOut(stdout: string): HookOut {
  const v: unknown = JSON.parse(stdout);
  if (v === null || typeof v !== "object") throw new Error(`hook printed non-object JSON: ${stdout}`);
  return v;
}
