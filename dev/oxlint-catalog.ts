#!/usr/bin/env bun
/** Write each oxlint rule of the base's scopes with its category to cli/sync/oxlint-catalog.json. */
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { readJson } from "../cli/json.ts";
import { captureTool } from "../cli/scripts/lint.ts";

const ROOT = path.join(import.meta.dirname, "..");
const CATALOG = "cli/sync/oxlint-catalog.json";
const SCOPES: ReadonlySet<string> = new Set(["eslint", "typescript", "unicorn", "oxc", "import", "vitest"]);

function buildListedSchema() {
  return z.array(z.looseObject({ category: z.string(), scope: z.string(), value: z.string() }));
}

/** The rules oxlint's `--rules --format=json` lists, as far as the catalog reads them. */
const listedSchema = /* @__PURE__ */ buildListedSchema();

/** Every rule of the catalog's scopes as `scope/value` mapped to its category, keys sorted. */
export function oxlintCatalog(listing: string): Record<string, string> {
  const listed = readJson(listedSchema, listing);

  const rules = listed
    .filter((rule) => SCOPES.has(rule.scope))
    .map((rule): [string, string] => [`${rule.scope}/${rule.value}`, rule.category]);

  return Object.fromEntries(rules.toSorted(([a], [b]) => a.localeCompare(b, "en")));
}

/** Lists the installed oxlint's rules, writes the catalog and formats it; returns the exit code. */
function run(root: string): number {
  const listing = captureTool("oxlint", ["--rules", "--format=json"], { root });

  if (listing.code !== 0) return listing.code;
  fs.writeFileSync(path.join(root, CATALOG), JSON.stringify(oxlintCatalog(listing.stdout)));

  return captureTool("bun fmt", [CATALOG], { root }).code;
}

if (import.meta.main) process.exitCode = run(ROOT);
