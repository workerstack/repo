/**
 * `variants:` in a subagent source: one file standing for one subagent per entry. Each entry needs a `name`, which
 * names its file beside the source, and deep-merges over the source's frontmatter without `variants`.
 */
import fs from "node:fs";

import { isRecord, type Json, type JsonObject } from "../../json.ts";
import { parseDoc } from "./frontmatter.ts";
import { MD, VARIANT_NAME } from "./sources.constants.ts";
import type { DocFile } from "./sources.types.ts";

/** One `variants:` entry: a frontmatter mapping whose `name` can name a file. */
export type Variant = JsonObject & { name: string };

function isVariant(value: Json): value is Variant {
  return isRecord(value) && typeof value["name"] === "string" && VARIANT_NAME.test(value["name"]);
}

/** Whether `value` is a well-formed `variants:` list. */
export function isVariantList(value: Json | undefined): value is Variant[] {
  return Array.isArray(value) && value.every((entry) => isVariant(entry));
}

/** `over` merged into `base`: maps merge key by key at every level, anything else in `over` wins. */
function deepMerge(base: JsonObject, over: JsonObject): JsonObject {
  const out: JsonObject = { ...base };

  for (const [key, value] of Object.entries(over)) {
    const under = out[key];
    out[key] = isRecord(under) && isRecord(value) ? deepMerge(under, value) : value;
  }

  return out;
}

/** The frontmatter one variant of a source gets: the source's without `variants`, with the variant's over it. */
export function withVariant(data: JsonObject, variant: Variant): JsonObject {
  const { variants: _variants, ...base } = data;

  return deepMerge(base, variant);
}

/**
 * Each file, or one file per entry of its well-formed `variants:`, named `<name>.md` beside it. A file that fails to
 * parse or holds malformed `variants` stays as it is, so reading it reports the problem.
 */
export function expandVariants(files: readonly DocFile[]): DocFile[] {
  return files.flatMap((file) => {
    let variants: Json | undefined;

    try {
      variants = parseDoc(file.rel, fs.readFileSync(file.abs, "utf8")).data["variants"];
    } catch {
      return [file];
    }

    if (!isVariantList(variants)) return [file];
    const dir = file.file.slice(0, file.file.lastIndexOf("/") + 1);

    return variants.map((variant) => ({ ...file, file: `${dir}${variant.name}${MD}`, variant }));
  });
}
