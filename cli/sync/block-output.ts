import type { Output } from "./outputs.ts";
import type { RegionResult } from "./region.ts";

/** The tracked block output at `rel` holding `result`'s text, with the repairs that led to it, when there are any. */
export function blockOutput(rel: string, { repairs, text }: RegionResult): Output {
  const output: Output = { content: text, kind: "file", managed: "block", path: rel, tracked: true };

  return repairs.length === 0 ? output : { ...output, repairs };
}
