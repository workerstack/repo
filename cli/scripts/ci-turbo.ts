/** The packages gate of `repo ci` under the workspace pack: turbo runs each package's typecheck and test. */
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { tryJson } from "../json.ts";
import { readWorkspace } from "../sync/workspace.ts";
import type { Gate } from "./ci-gate.ts";
import {
  CACHED_LINE,
  COVERAGE_ENV,
  COVERAGE_OFF,
  COVERAGE_ON,
  FAILED_LINE,
  REPORT_ENV,
  REPORT_RELATIVE,
  SHARD_ENV,
  TASKS_LINE,
  TURBO_ARGS,
} from "./ci-turbo.constants.ts";
import type { Captured } from "./lint.ts";

/** Runs turbo with `args` in `cwd` and `env` on top of the process's; `missing` is why there is no binary to run. */
export type TurboRun = (args: string[], cwd: string, env: Record<string, string>) => Captured | { missing: string };

/**
 * What the packages gate runs with: the repo root, whether coverage is on, the merged report's path if asked and the
 * `i/n` slice of each package's test files, if only one.
 */
export type TurboOptions = { root: string; coverage: boolean; json: string | undefined; shard?: string | undefined };

type ReportShape = z.ZodObject<
  { success: z.ZodOptional<z.ZodBoolean>; testResults: z.ZodDefault<z.ZodArray<z.ZodUnknown>> },
  z.core.$loose
>;

function reportShape(): ReportShape {
  return z.looseObject({ success: z.boolean().optional(), testResults: z.array(z.unknown()).default([]) });
}

/** One package's vitest report, as far as the merge reads it. */
export type PackageReport = z.output<ReportShape>;

/** The variables the flags ask turbo's tasks to see. */
function envOf({ coverage, json, shard }: TurboOptions): Record<string, string> {
  return {
    [COVERAGE_ENV]: coverage ? COVERAGE_ON : COVERAGE_OFF,
    ...(json === undefined ? {} : { [REPORT_ENV]: REPORT_RELATIVE }),
    ...(shard === undefined ? {} : { [SHARD_ENV]: shard }),
  };
}

/** The gate for a turbo run: the task and cached counts, or the failed tasks and turbo's output; `named` ends it. */
function gateOf(run: Captured, named: string): Gate {
  const text = `${run.stdout}${run.stderr}`;

  if (run.code === 0) {
    const tasks = TASKS_LINE.exec(text)?.[1];
    const cached = CACHED_LINE.exec(text)?.[1];
    const label = tasks === undefined || cached === undefined ? "ok" : `${tasks} tasks, ${cached} cached`;

    return { label: `packages ${label}${named}`, ok: true, output: [], ran: true };
  }

  const failed = FAILED_LINE.exec(text)?.[1]?.trim();
  const label = `packages failed${failed === undefined ? "" : ` (${failed})`}${named}`;

  return { label, ok: false, output: [text], ran: true };
}

/** One report from all of them: the test files together, the counts summed and `success` only if every one had it. */
export function mergeReports(reports: readonly PackageReport[]): Record<string, unknown> {
  const totals: Record<string, number> = {};

  for (const report of reports) {
    for (const [key, value] of Object.entries(report))
      if (typeof value === "number") totals[key] = (totals[key] ?? 0) + value;
  }

  return {
    ...totals,
    success: reports.every((report) => report.success !== false),
    testResults: reports.flatMap((report) => report.testResults),
  };
}

/** Each package's report, parsed; a package that wrote none, or one that is not a report, is left out. */
function packageReports(root: string): PackageReport[] {
  const workspace = readWorkspace(root);
  const dirs = workspace.ok ? workspace.workspace.packages.map((pkg) => pkg.dir) : [];

  return dirs.flatMap((dir) => {
    try {
      return tryJson(reportShape(), fs.readFileSync(path.join(root, dir, REPORT_RELATIVE), "utf8")) ?? [];
    } catch {
      return [];
    }
  });
}

/** Runs `turbo run typecheck test`, then writes the packages' merged report to `json` when one is asked for. */
export function packagesGate(options: TurboOptions, run: TurboRun): Gate {
  const result = run([...TURBO_ARGS], options.root, envOf(options));

  if (options.json !== undefined)
    fs.writeFileSync(options.json, JSON.stringify(mergeReports(packageReports(options.root))));

  if ("missing" in result) return { label: `packages failed: ${result.missing}`, ok: false, output: [], ran: false };

  return gateOf(result, options.shard === undefined ? "" : ` (shard ${options.shard})`);
}
