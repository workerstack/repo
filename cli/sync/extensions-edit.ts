import { applyEdits, modify, parse } from "jsonc-parser";
import { z } from "zod";

import { editJsonc } from "./jsonc-edit.ts";
import type { RegionResult } from "./region.ts";

const RECOMMENDATIONS_KEY = "recommendations";

function listSchema() {
  return z.object({ [RECOMMENDATIONS_KEY]: z.array(z.string()).optional() });
}

/**
 * The `.vscode/extensions.json` text with each id of `wanted` the file lacks added to `recommendations`, every other
 * key, comment and recommendation as written, and the repair that explains it when the file is left as is: not valid
 * JSONC, holding no object, or a `recommendations` that is not a list of ids.
 */
export function extensionsEdit(existing: string | null, wanted: readonly string[]): RegionResult {
  return editJsonc(existing, (text, formatting) => {
    const read = listSchema().safeParse(parse(text, [], { allowTrailingComma: true }));

    if (!read.success) return { repair: `${RECOMMENDATIONS_KEY} must be a list of extension ids; left as is` };
    const held = read.data[RECOMMENDATIONS_KEY];
    const missing = wanted.filter((id) => !(held ?? []).includes(id));

    if (held === undefined) {
      const added = modify(text, [RECOMMENDATIONS_KEY], missing, { formattingOptions: formatting });

      return { text: applyEdits(text, added) };
    }

    let edited = text;

    for (const [at, id] of missing.entries()) {
      const options = { formattingOptions: formatting, isArrayInsertion: true };
      edited = applyEdits(edited, modify(edited, [RECOMMENDATIONS_KEY, held.length + at], id, options));
    }

    return { text: edited };
  });
}
