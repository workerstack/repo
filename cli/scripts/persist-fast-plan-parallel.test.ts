import { describe, expect, it } from "vitest";

import { useTmpWs } from "./__fixtures__/persist-plan-kit.ts";
import { persistFastPlan } from "./persist-fast-plan.ts";

const tmpWs = useTmpWs("persist-fast-plan-parallel-");

const DISJOINT = "parallel steps need disjoint files";

const STEPS = ["1 [ ] parse the flag", "2 [ ] print it"];

/** A fast plan whose steps 1 and 2 end with `(parallel: lists[i])`, unless that list is null. */
function plan(lists: (string | null)[], verify = "3 [ ] the flag prints") {
  const steps = STEPS.map((s, i) => {
    const list = lists[i];

    return list === undefined || list === null ? s : `${s} (parallel: ${list})`;
  });

  return [
    "FAST_PLAN_NAME: print a flag",
    "commit: feat: print a flag",
    "# print-a-flag",
    "",
    "## Goal",
    "Print the flag.",
    "",
    "## Steps",
    ...steps,
    "",
    "## Verify",
    verify,
    "",
  ].join("\n");
}

function save(content: string) {
  return persistFastPlan({ content, created: "2026-11-14T19:00:00Z", strategy: "spawn-fast", workspaceRoot: tmpWs() });
}

describe("parallel steps on a fast plan", () => {
  it.each([
    { one: "src/parse.ts, src/parse.test.ts", two: "src/print.ts, src/print.test.ts" },
    { one: "cli/*.ts", two: "cli/bench/" },
  ])("save $one beside $two", ({ one, two }) => {
    const r = save(plan([one, two]));
    expect(r.ok, r.error).toBe(true);
  });

  it.each([
    { error: "step 2 is parallel alone; parallel needs two or more adjacent steps", one: null, two: "a.ts" },
    { error: "step 1 is parallel with no files; list the files it writes after parallel:", one: "", two: "a.ts" },
    { error: `parallel steps 1 and 2 both list src/cli.ts; ${DISJOINT}`, one: "src/cli.ts", two: "src/cli.ts" },
    { error: `parallel steps 1 and 2 both list src/cli.ts; ${DISJOINT}`, one: "src/cli.ts", two: "src\\cli.ts" },
    { error: `parallel steps 1 and 2 overlap at src/ and src/cli.ts; ${DISJOINT}`, one: "src/", two: "src/cli.ts" },
    {
      error: `parallel steps 1 and 2 overlap at src/*.ts and src/cli.ts; ${DISJOINT}`,
      one: "src/*.ts",
      two: "src/cli.ts",
    },
  ])("deny $one beside $two", ({ error, one, two }) => {
    expect(save(plan([one, two])).errors).toContain(error);
  });

  it("denies a marker on a Verify box", () => {
    const r = save(plan(["a.ts", "b.ts"], "3 [ ] the flag prints (parallel: c.ts)"));
    expect(r.errors).toContain("verify box 3 ends with parallel:; only steps may run at once");
  });
});
