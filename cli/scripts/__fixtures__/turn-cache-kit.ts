/** A consumer with an edit to gate, and runs of turn in it, for the pass cache tests. */
import { expect } from "vitest";

import { consumer, recording, srcConfig, TSCONFIG, turn, write } from "./turn-repo.ts";

/** A consumer that typechecks `src`, ignores `.env`, and whose `src/a.ts` changed since its commit. */
export function edited(files: Record<string, string> = {}, options: { deps?: boolean } = {}): string {
  const base = {
    ".gitignore": ".env\n",
    "src/a.ts": "export const a = 1;\n",
    "tsconfig.json": TSCONFIG,
    ...srcConfig(),
  };

  const root = consumer({ ...base, ...files }, options);
  write(root, { "src/a.ts": "export const a = 2;\n" });

  return root;
}

/** The tool calls of a turn in `root`, and its result. */
export async function turnCalls(root: string) {
  const rec = recording(root);
  const result = await turn(root, [], rec.bins);

  return { calls: rec.calls, result };
}

/** The labels of a summary line. */
export function labels(out: string): string[] {
  return out.trimEnd().split(" · ").slice(1);
}

/** A passing turn, then `between`, then the tool calls of the next turn. */
export async function rerun(root: string, between: () => void): Promise<string[]> {
  const first = await turnCalls(root);
  expect(first.result.code, first.result.err).toBe(0);
  between();

  const next = await turnCalls(root);

  return next.calls;
}
