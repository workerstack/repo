import { applyEdits, modify, parse } from "jsonc-parser";
import { z } from "zod";

import type { JsonObject } from "../json.ts";
import { byCodeUnit } from "./by-code-unit.ts";
import { editJsonc } from "./jsonc-edit.ts";
import type { RegionResult } from "./region.ts";
import { DEPRECATED_TSDK_KEY, TSDK_KEY } from "./vscode-defaults.constants.ts";

const READONLY_KEY = "files.readonlyInclude";

/**
 * The `.vscode/settings.json` text with `files.readonlyInclude` set to `paths` and each key of `defaults` the file
 * lacks added, every other key and comment as written, and the repair that explains it when the file is left as is:
 * not valid JSONC, or holding no object. A key the file already holds keeps its value, whatever `defaults` says. The
 * deprecated `typescript.tsdk` moves to `js/ts.tsdk.path`, unless that key is already held, and then it is dropped.
 */
export function settingsEdit(existing: string | null, paths: readonly string[], defaults: JsonObject): RegionResult {
  return editJsonc(existing, (text, formatting) => {
    const readonly = Object.fromEntries(paths.toSorted(byCodeUnit).map((rel) => [rel, true]));
    // Inserted first, the new key leaves every neighbour's whitespace as written; appended, its formatting would
    // rewrite the last one's.
    const options = { formattingOptions: formatting, getInsertionIndex: () => 0 };
    let edited = applyEdits(text, modify(text, [READONLY_KEY], readonly, options));
    const held = z.record(z.string(), z.unknown()).parse(parse(edited, [], { allowTrailingComma: true }));

    if (DEPRECATED_TSDK_KEY in held) {
      if (!(TSDK_KEY in held)) {
        edited = applyEdits(edited, modify(edited, [TSDK_KEY], held[DEPRECATED_TSDK_KEY], options));
        held[TSDK_KEY] = held[DEPRECATED_TSDK_KEY];
      }

      edited = applyEdits(edited, modify(edited, [DEPRECATED_TSDK_KEY], undefined, options));
    }

    // Each goes in first, so the last one in leads: walking the keys backwards leaves them sorted.
    for (const key of Object.keys(defaults).toSorted(byCodeUnit).toReversed())
      if (!(key in held)) edited = applyEdits(edited, modify(edited, [key], defaults[key], options));

    return { text: edited };
  });
}
