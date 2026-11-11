import fs from "node:fs";

import { checkPackage, createPackageFromTarballData } from "@arethetypeswrong/core";
import { problemKindInfo } from "@arethetypeswrong/core/problems";
import { publint } from "publint";
import { formatMessage } from "publint/utils";

import {
  attwLine,
  ESM_ONLY_IGNORED,
  MODULE_TYPE,
  PUBLINT_LEVEL,
  publintLine,
  REQUIRE_CONDITION,
} from "./tarball-lint.constants.ts";

type Manifest = Record<string, unknown>;
/** The parts every attw problem shares; the kinds without an entrypoint or a resolution kind leave them out. */
type Problem = { kind: keyof typeof problemKindInfo; entrypoint?: string; resolutionKind?: string };

/** Whether any condition object in `exports` has a `require` key. */
function hasRequire(exports: unknown): boolean {
  if (typeof exports !== "object" || exports === null) return false;
  return Object.entries(exports).some(([key, value]) => key === REQUIRE_CONDITION || hasRequire(value));
}

/** Whether the package can only be imported: `type` is `module` and no export has a `require` condition. */
const isEsmOnly = (manifest: Manifest): boolean => manifest.type === MODULE_TYPE && !hasRequire(manifest.exports);

/**
 * Runs publint (strict, suggestions included) and attw on a packed tarball.
 * The attw resolution kinds an ESM-only package cannot satisfy are ignored.
 * Returns one line per remaining problem; empty when the tarball is clean.
 */
export async function tarballLint(tarball: string): Promise<string[]> {
  const data = fs.readFileSync(tarball);
  const bytes = new Uint8Array(data);
  const linted = await publint({ level: PUBLINT_LEVEL, pack: { tarball: bytes.buffer }, strict: true });
  const manifest: Manifest = { ...linted.pkg };
  const ignored = isEsmOnly(manifest) ? ESM_ONLY_IGNORED : [];
  const analysis = await checkPackage(await createPackageFromTarballData(bytes));
  const problems: Problem[] = "problems" in analysis ? analysis.problems : [];
  return [
    ...linted.messages.map((message) => publintLine(String(formatMessage(message, manifest)))),
    ...problems
      .filter((problem) => !ignored.includes(problem.resolutionKind ?? ""))
      .map((problem) =>
        attwLine({
          entrypoint: problem.entrypoint,
          kind: problem.kind,
          resolution: problem.resolutionKind,
          why: problemKindInfo[problem.kind].description,
        }),
      ),
  ];
}
