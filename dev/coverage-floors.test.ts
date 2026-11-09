import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { FLOORS_REL, SUMMARY_REL, writeFloors } from "./coverage-floors.ts";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "coverage-floors.ts");
const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-floors-")));
  temps.push(root);
  fs.mkdirSync(path.join(root, "cli/scripts"), { recursive: true });
  return root;
}

const metric = (pct: number) => ({ total: 100, covered: pct, skipped: 0, pct });
const file = (statements: number, branches: number, functions: number, lines: number) => ({
  statements: metric(statements),
  branches: metric(branches),
  functions: metric(functions),
  lines: metric(lines),
});

/** A vitest json-summary: the total, one script under cli/scripts, and a file outside it. */
function measure(root: string, job: ReturnType<typeof file>): void {
  const summary = {
    total: file(90, 90, 90, 90),
    [path.join(root, "cli/scripts/job.ts")]: job,
    [path.join(root, "cli/sync/trees.ts")]: file(100, 100, 100, 100),
  };
  fs.mkdirSync(path.dirname(path.join(root, SUMMARY_REL)), { recursive: true });
  fs.writeFileSync(path.join(root, SUMMARY_REL), JSON.stringify(summary));
}

const floors = (root: string): unknown => JSON.parse(fs.readFileSync(path.join(root, FLOORS_REL), "utf8"));

describe("writeFloors", () => {
  it("writes each cli/scripts file's four metrics floored to integers, and nothing outside cli/scripts", () => {
    const root = tempRoot();
    measure(root, file(62.9, 77.5, 80, 61.99));
    expect(writeFloors(root)).toEqual({ ok: true, raised: ["cli/scripts/job.ts statements new → 62", "cli/scripts/job.ts branches new → 77", "cli/scripts/job.ts functions new → 80", "cli/scripts/job.ts lines new → 61"] });
    expect(floors(root)).toEqual({ "cli/scripts/job.ts": { statements: 62, branches: 77, functions: 80, lines: 61 } });
  });

  it("refuses a lower measurement and leaves the floors as they were", () => {
    const root = tempRoot();
    measure(root, file(62, 77, 80, 61));
    writeFloors(root);
    const before = fs.readFileSync(path.join(root, FLOORS_REL), "utf8");
    measure(root, file(60.5, 77, 80, 61));
    expect(writeFloors(root)).toEqual({ ok: false, errors: ["coverage floor for job.ts statements would drop 62 → 60"] });
    expect(fs.readFileSync(path.join(root, FLOORS_REL), "utf8")).toBe(before);
  });

  it("raises a floor when the measurement goes up and keeps the ones that did not move", () => {
    const root = tempRoot();
    measure(root, file(62, 77, 80, 61));
    writeFloors(root);
    measure(root, file(70.2, 77, 80, 61));
    expect(writeFloors(root)).toEqual({ ok: true, raised: ["cli/scripts/job.ts statements 62 → 70"] });
    expect(floors(root)).toEqual({ "cli/scripts/job.ts": { statements: 70, branches: 77, functions: 80, lines: 61 } });
  });

  it("names a missing summary", () => {
    const root = tempRoot();
    expect(writeFloors(root)).toEqual({ ok: false, errors: [`no ${SUMMARY_REL}: run bun --bun vitest run --coverage first`] });
  });
});

describe("the CLI", () => {
  it("exits non-zero with the message on a drop, and zero when the floors hold", () => {
    const root = tempRoot();
    measure(root, file(62, 77, 80, 61));
    const run = () => spawnSync("bun", [SCRIPT], { cwd: root, encoding: "utf8" });
    const first = run();
    expect(first.status).toBe(0);
    expect(first.stdout).toContain(`wrote ${FLOORS_REL}`);
    measure(root, file(62, 77, 79, 61));
    const drop = run();
    expect(drop.status).toBe(1);
    expect(drop.stderr).toBe("coverage floor for job.ts functions would drop 80 → 79\n");
  });
});
