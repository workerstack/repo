import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { must } from "./__fixtures__/orchestrate-kit.ts";
import { FRESH_DENY, PLAN, ROADMAP, saveStrategyKit, sending } from "./__fixtures__/save-strategy-kit.ts";

const { edit, landed, read, savedPlan, set, strategyLines, workspace, write } = saveStrategyKit();

describe("a strategy: line the agent sends on a fresh save or a saved plan", () => {
  it.each([
    ["plan", ".repo/plans/x.md", sending(PLAN, "free")],
    ["roadmap", ".repo/roadmaps/x.md", sending(ROADMAP, "free")],
  ])("is refused on a fresh %s, even one that equals the session value", async (_kind, file, body) => {
    const ws = workspace();
    await set(ws, "c1", "free");
    const out = must(await write({ sid: "c1", ws }, file, body));
    expect(out.permissionDecision).toBe("deny");
    expect(out.permissionDecisionReason).toContain(FRESH_DENY);
    const dir = path.join(ws, path.dirname(file));
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toStrictEqual([]);
  });

  it("is refused when a Write to a saved plan changes it", async () => {
    const ws = workspace();
    const file = await savedPlan(ws, "c2");
    const body = read(file).replace("strategy: free", "strategy: spawn-deep");
    const out = must(await write({ sid: "c2", ws }, file, body));
    expect(out.permissionDecision).toBe("deny");
    expect(out.permissionDecisionReason).toContain(FRESH_DENY);
  });

  it("is refused when an Edit of a saved plan changes it", async () => {
    const ws = workspace();
    const file = await savedPlan(ws, "c3");
    const out = must(await edit({ sid: "c3", ws }, file, { from: "strategy: free", to: "strategy: spawn-deep" }));
    expect(out.permissionDecision).toBe("deny");
    expect(out.permissionDecisionReason).toContain(FRESH_DENY);
    expect(read(file)).toContain("strategy: free");
  });
});

describe("a strategy: line the agent sends on a saved roadmap, or leaves out", () => {
  it("is refused when a Write to a saved roadmap changes it", async () => {
    const ws = workspace();
    const file = landed(await write({ sid: "c4", ws }, ".repo/roadmaps/x.md", ROADMAP)).file;
    const body = read(file).replace("strategy: free", "strategy: spawn-fast");
    const out = must(await write({ sid: "c4", ws }, file, body));
    expect(out.permissionDecision).toBe("deny");
    expect(out.permissionDecisionReason).toContain(FRESH_DENY);
  });

  it("passes on a Write that sends the saved value again", async () => {
    const ws = workspace();
    const file = await savedPlan(ws, "c5");
    const body = read(file).replace("1.1 [ ]", "1.1 [x]");
    const { text } = landed(await write({ sid: "c5", ws }, file, body));
    expect(strategyLines(text)).toStrictEqual(["strategy: free"]);
    expect(text).toMatch(/^1\.1 \[x\] /m);
  });
});

describe("a saved plan that sends none or the same strategy", () => {
  it("passes on a Write that sends none, and the saved value stays", async () => {
    const ws = workspace();
    await set(ws, "c6", "spawn-fast");
    const file = await savedPlan(ws, "c6");

    const body = read(file)
      .replace(/^strategy: .*\n/m, "")
      .replace("1.1 [ ]", "1.1 [x]");

    const { text } = landed(await write({ sid: "c6", ws }, file, body));
    expect(strategyLines(text)).toStrictEqual(["strategy: spawn-fast"]);
  });

  it("passes on an Edit that leaves it alone", async () => {
    const ws = workspace();
    const file = await savedPlan(ws, "c7");
    expect(await edit({ sid: "c7", ws }, file, { from: "1.1 [ ]", to: "1.1 [x]" })).toBeNull();
  });
});
