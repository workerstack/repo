import fs from "node:fs";

import { afterEach, beforeEach, vi } from "vitest";

/** What a test run wrote to stdout and stderr, and the temp dirs it made and the hooks remove. */
export type CapturedRun = { out: string[]; err: string[]; temps: string[] };

/** Per test: captures the process's stdout and stderr, then restores them and the cwd and removes the temp dirs. */
export function useCapturedRun(): CapturedRun {
  const saved = process.cwd();
  const run: CapturedRun = { err: [], out: [], temps: [] };
  beforeEach(() => {
    run.out.length = 0;
    run.err.length = 0;
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => run.out.push(String(chunk)) > 0);
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => run.err.push(String(chunk)) > 0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(saved);
    for (const dir of run.temps.splice(0)) fs.rmSync(dir, { force: true, recursive: true });
  });
  return run;
}
