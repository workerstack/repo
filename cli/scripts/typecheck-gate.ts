import fs from "node:fs";
import path from "node:path";

import { readWorkspace } from "../sync/workspace.ts";
import { fail, pass, plural, skip, textOf, type Gate, type GateCtx } from "./ci-gate.ts";
import {
  SKIPPED_SEGMENTS,
  TSBUILDINFO_DIR,
  TSBUILDINFO_EXTENSION,
  TSCONFIG_FILE,
  TSC_ARGS,
  TSC_PROJECT_FLAG,
} from "./ci.constants.ts";

type Found = { ok: true; files: string[] } | { ok: false; errors: string[] };

/** The root-relative tsconfigs of the root and each package that is not a fixture or an install. */
function tsconfigs(root: string, { rootOnly }: { rootOnly: boolean }): Found {
  const workspace = readWorkspace(root);
  if (!workspace.ok) return workspace;
  const dirs = (rootOnly ? [] : workspace.workspace.packages)
    .map((pkg) => pkg.dir)
    .filter((dir) => !dir.split("/").some((segment) => SKIPPED_SEGMENTS.includes(segment)));
  const files = [".", ...dirs].flatMap((dir) =>
    fs
      .readdirSync(path.join(root, dir), { withFileTypes: true })
      .filter((entry) => entry.isFile() && TSCONFIG_FILE.test(entry.name))
      .map((entry) => path.posix.join(dir, entry.name))
      .toSorted(),
  );
  return { files, ok: true };
}

/** tsc's args for `file`: incremental, its build info named after its root-relative path with `/` as `-`. */
function tscArgs(file: string): string[] {
  return [
    ...TSC_ARGS,
    path.posix.join(TSBUILDINFO_DIR, `${file.replaceAll("/", "-")}${TSBUILDINFO_EXTENSION}`),
    TSC_PROJECT_FLAG,
    file,
  ];
}

/**
 * `tsc --noEmit` on every tsconfig of the root and each package; under the pack only the root's, since turbo
 * typechecks the packages.
 */
export function typecheckGate(ctx: GateCtx, { rootOnly }: { rootOnly: boolean }): Gate {
  const found = tsconfigs(ctx.root, { rootOnly });
  if (!found.ok) {
    return fail(
      "typecheck failed",
      found.errors.map((line) => `${line}\n`),
    );
  }
  if (found.files.length === 0) return skip("typecheck skipped (no tsconfig.json)");
  const runs = found.files.map((file) => ({ file, run: ctx.bins.tsc(tscArgs(file), ctx.root) }));
  const bad = runs.filter(({ run }) => run.code !== 0);
  if (bad.length === 0) return pass(`typecheck ${plural(found.files.length, "config")}`);
  return fail(
    `typecheck failed (${bad.map(({ file }) => file).join(", ")})`,
    bad.map(({ run }) => textOf(run)),
  );
}
