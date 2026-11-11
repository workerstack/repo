#!/usr/bin/env bun
/** Write the names of the oxlint rules in the base's categories and scopes to cli/sync/oxlint-catalog.json. */
import fs from "node:fs";
import path from "node:path";
import { captureTool } from "../cli/scripts/lint.ts";

const ROOT = path.join(import.meta.dirname, "..");
const CATALOG = "cli/sync/oxlint-catalog.json";
const SCOPES: ReadonlySet<string> = new Set(["eslint", "typescript", "unicorn", "oxc", "import", "vitest"]);
const CATEGORIES: ReadonlySet<string> = new Set(["correctness", "suspicious"]);

type Listed = { scope: string; value: string; category: string };

/** The `scope/value` names oxlint lists in the catalog's categories and scopes, sorted. */
export function oxlintCatalog(listing: string): string[] {
  const listed = JSON.parse(listing) /* oxlint's rules json has this shape */ as Listed[];
  return listed
    .filter((rule) => CATEGORIES.has(rule.category) && SCOPES.has(rule.scope))
    .map((rule) => `${rule.scope}/${rule.value}`)
    .toSorted();
}

/** Lists the installed oxlint's rules, writes the catalog and formats it; returns the exit code. */
function run(root: string): number {
  const listing = captureTool("oxlint", ["--rules", "--format=json"], root);
  if (listing.code !== 0) return listing.code;
  fs.writeFileSync(path.join(root, CATALOG), JSON.stringify(oxlintCatalog(listing.stdout)));
  return captureTool("oxfmt", [CATALOG], root).code;
}

if (import.meta.main) process.exitCode = run(ROOT);
