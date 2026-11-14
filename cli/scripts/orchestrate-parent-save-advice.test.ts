import { describe, expect, it } from "vitest";

import { must } from "./__fixtures__/orchestrate-kit.ts";
import { ADVICE, BAD_ADVICE, PLAN, ROADMAP, saveStrategyKit } from "./__fixtures__/save-strategy-kit.ts";

const { edit, landed, read, savedPlan, workspace, write } = saveStrategyKit();

describe("the advice: line when it is bad", () => {
  it("is refused when a fresh Write sends a bad one", async () => {
    const ws = workspace();
    const body = PLAN.replace(ADVICE, "advice: spawn-deep");
    const out = must(await write({ sid: "d1", ws }, ".repo/plans/x.md", body));
    expect(out.permissionDecision).toBe("deny");
    expect(out.permissionDecisionReason).toContain(BAD_ADVICE);
  });

  it("is refused when it is over 100 characters", async () => {
    const ws = workspace();
    const body = PLAN.replace(ADVICE, `advice: free because ${"x".repeat(100)}`);
    const out = must(await write({ sid: "d2", ws }, ".repo/plans/x.md", body));
    expect(out.permissionDecision).toBe("deny");
    expect(out.permissionDecisionReason).toContain(BAD_ADVICE);
  });

  it("is refused when a Write to a saved plan sends a bad one", async () => {
    const ws = workspace();
    const file = await savedPlan(ws, "d3");
    const body = read(file).replace(ADVICE, "advice: soon");
    const out = must(await write({ sid: "d3", ws }, file, body));
    expect(out.permissionDecision).toBe("deny");
    expect(out.permissionDecisionReason).toContain(BAD_ADVICE);
  });
});

describe("the advice: line on an Edit or a roadmap", () => {
  it("is refused when an Edit of a saved plan makes it bad", async () => {
    const ws = workspace();
    const file = await savedPlan(ws, "d4");
    const out = must(await edit({ sid: "d4", ws }, file, { from: ADVICE, to: "advice: soon" }));
    expect(out.permissionDecision).toBe("deny");
    expect(out.permissionDecisionReason).toContain(BAD_ADVICE);
    expect(read(file)).toContain(ADVICE);
  });

  it("is refused on a fresh roadmap with a bad one", async () => {
    const out = must(
      await write({ sid: "d5", ws: workspace() }, ".repo/roadmaps/x.md", ROADMAP.replace(ADVICE, "advice: soon")),
    );

    expect(out.permissionDecision).toBe("deny");
    expect(out.permissionDecisionReason).toContain(BAD_ADVICE);
  });
});

describe("the advice: line on an update", () => {
  it("stays on a saved plan when the update does not send it", async () => {
    const ws = workspace();
    const file = await savedPlan(ws, "d6");
    const body = read(file).replace(`${ADVICE}\n`, "").replace("1.1 [ ]", "1.1 [x]");

    const { text } = landed(await write({ sid: "d6", ws }, file, body));
    expect(text).toContain(`strategy: free\n${ADVICE}\n`);
  });

  it("is kept on an update that sends a new valid one", async () => {
    const ws = workspace();
    const file = await savedPlan(ws, "d7");

    const { text } = landed(
      await write({ sid: "d7", ws }, file, read(file).replace(ADVICE, "advice: free because small")),
    );

    expect(text).toContain("strategy: free\nadvice: free because small\n");
  });
});
