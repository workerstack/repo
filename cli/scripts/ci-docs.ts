/** The `docs` gate of `repo ci`: `repo docs --check` under the docs pack, with its findings under a failed line. */
import type { Pack } from "../config.ts";
import { DOCS_ARGS, DOCS_GATE, DOCS_PACK } from "./ci-docs.constants.ts";
import { fail, pass, textOf, type Gate } from "./ci-gate.ts";
import type { Captured } from "./lint.ts";

/** What the gate runs with: the repo root and the `repo <args>` runner. */
export type DocsCtx = { root: string; repo: (args: string[], cwd: string) => Captured };

/** `repo docs --check` as the gate `docs`. */
function docsGate(ctx: DocsCtx): Gate {
  const run = ctx.repo([...DOCS_ARGS], ctx.root);

  return run.code === 0 ? pass(`${DOCS_GATE} ok`) : fail(`${DOCS_GATE} failed`, [textOf(run)]);
}

/** The docs gate when the docs pack is on, none otherwise. */
export function docsGates(packs: readonly Pack[]): ((ctx: DocsCtx) => Gate)[] {
  return packs.includes(DOCS_PACK) ? [docsGate] : [];
}
