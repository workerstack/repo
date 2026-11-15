/** Checks each `lint.plugins` file: it is a file, it imports, it exports a plugin, and the `lint.rules` exist in it. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import type { ResolvedLint } from "./config-resolved.types.ts";

const NOT_A_PLUGIN = "does not default-export a plugin like { meta: { name }, rules: {} }";

/** The rule names a plugin exports, or the refusal line when the file is no plugin; this reads the file system. */
async function load(root: string, name: string, file: string): Promise<{ rules: string[] } | { error: string }> {
  const at = path.join(root, file);

  if (fs.statSync(at, { throwIfNoEntry: false })?.isFile() !== true)
    return { error: `lint.plugins.${name}: ${file} is no file` };

  let loaded: unknown;

  try {
    loaded = await import(pathToFileURL(at).href);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return { error: `lint.plugins.${name}: ${file} failed to import: ${message.split("\n")[0]}` };
  }

  const plugin = z.object({ default: z.object({ rules: z.record(z.string(), z.unknown()) }) }).safeParse(loaded);

  if (!plugin.success) return { error: `lint.plugins.${name}: ${file} ${NOT_A_PLUGIN}` };

  return { rules: Object.keys(plugin.data.default.rules) };
}

/**
 * The refusals for the plugins in `lint`, one line each, empty when all pass. A plugin is judged by the name it is
 * registered under, not its own `meta.name`; one that fails to load gets no rule checks.
 */
export async function checkLintPlugins(root: string, lint: ResolvedLint): Promise<string[]> {
  const results = await Promise.all(
    Object.entries(lint.plugins).map(async ([name, file]) => ({ name, result: await load(root, name, file) })),
  );

  const errors: string[] = [];
  const exported = new Map<string, string[]>();

  for (const { name, result } of results) {
    if ("error" in result) errors.push(result.error);
    else exported.set(name, result.rules);
  }

  for (const [index, entry] of lint.rules.entries()) {
    for (const key of Object.keys(entry.rules)) {
      const slash = key.indexOf("/");
      const rules = exported.get(key.slice(0, slash));

      if (slash < 0 || rules === undefined || rules.includes(key.slice(slash + 1))) continue;
      const file = lint.plugins[key.slice(0, slash)];
      const has = rules.length > 0 ? rules.join(", ") : "no rules";

      errors.push(`lint.rules[${index}].rules: "${key}" is not a rule of ${file}; it has ${has}`);
    }
  }

  return errors;
}
