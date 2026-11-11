import type { Fakes } from "./mutate-fakes.ts";
import { at } from "./mutate-fakes.ts";
import type { ShardReport } from "../mutate-report.ts";

/** A head that differs from the fixtures' `SHA`. */
export const OTHER = "1a2b3c4bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
/** A mutant the tests left alive. */
export const survivor = { column: 1, line: 1, mutator: "m", status: "Survived" } as const;

/** Puts `reports` in the fake's `reports` dir as `mutation-1.json`, `mutation-2.json`, and so on. */
export function plantReports(f: Fakes, reports: readonly ShardReport[]): void {
  for (const [i, report] of reports.entries()) f.files.set(at("reports", `mutation-${i + 1}.json`), JSON.stringify(report));
}
