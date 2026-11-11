import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { oxlintCatalog } from "../../dev/oxlint-catalog.ts";
import { captureTool } from "../scripts/lint.ts";
import catalog from "./oxlint-catalog.json" with { type: "json" };
import { OFF_RULES } from "./oxlint-rules.ts";

const SLOW = 60_000;

/** The names oxlint lists in the catalog's categories and scopes, sorted. */
function installedCatalog(): string[] {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-oxlint-rules-"));
  try {
    return oxlintCatalog(captureTool("oxlint", ["--rules", "--format=json"], root).stdout);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

it("every rule the base opts out of is in the catalog and says why", () => {
  for (const [rule, reason] of Object.entries(OFF_RULES)) {
    expect(catalog, rule).toContain(rule);
    expect(reason.trim(), rule).not.toBe("");
  }
});

it(
  "the catalog lists exactly the rules the installed oxlint has",
  () => {
    expect(catalog, "the catalog is stale: run `bun dev/oxlint-catalog.ts`").toEqual(installedCatalog());
  },
  SLOW,
);
