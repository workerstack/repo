import { describe, expect, it } from "vitest";

import { ADVICE, PLAN, ROADMAP, saveStrategyKit } from "./__fixtures__/save-strategy-kit.ts";

const { inProgressRoadmap, landed, plant, read, set, strategyLines, workspace, write } = saveStrategyKit();

describe("a fresh plan takes the session value or the parent roadmap's", () => {
  it("takes the session value and writes the advice right after it", async () => {
    const ws = workspace("spawn-deep");
    await set(ws, "a1", "spawn-fast");
    const { text } = landed(await write({ sid: "a1", ws }, ".repo/plans/x.md", PLAN));
    expect(strategyLines(text)).toStrictEqual(["strategy: spawn-fast"]);
    expect(text).toContain(`strategy: spawn-fast\n${ADVICE}\n`);
  });

  it("takes the session value over an in-progress roadmap's", async () => {
    const ws = workspace();
    await set(ws, "a2", "spawn-fast");
    await inProgressRoadmap(ws, "a2", "spawn-deep");
    const { text } = landed(await write({ sid: "a2", ws }, ".repo/plans/x.md", PLAN));
    expect(strategyLines(text)).toStrictEqual(["strategy: spawn-fast"]);
  });

  it("takes the strategy of the newest in-progress roadmap this session saved, over the config", async () => {
    const ws = workspace("spawn-fast");
    await inProgressRoadmap(ws, "a3", "spawn-deep");
    const { text } = landed(await write({ sid: "a3", ws }, ".repo/plans/x.md", PLAN));
    expect(strategyLines(text)).toStrictEqual(["strategy: spawn-deep"]);
  });

  it("takes the strategy of an in-progress roadmap this session only re-saved", async () => {
    const ws = workspace("spawn-fast");
    const file = await inProgressRoadmap(ws, "other", "spawn-deep");
    const again = landed(await write({ sid: "a4", ws }, file, read(file)));
    expect(again.file).toBe(file);
    const { text } = landed(await write({ sid: "a4", ws }, ".repo/plans/y.md", PLAN));
    expect(strategyLines(text)).toStrictEqual(["strategy: spawn-deep"]);
  });
});

describe("a fresh plan falls back to the config, then free", () => {
  it("does not take the strategy of a roadmap another session saved and this one never touched", async () => {
    const ws = workspace("spawn-fast");
    await inProgressRoadmap(ws, "other", "spawn-deep");
    const { text } = landed(await write({ sid: "a5", ws }, ".repo/plans/x.md", PLAN));
    expect(strategyLines(text)).toStrictEqual(["strategy: spawn-fast"]);
  });

  it("skips a roadmap that is not in progress", async () => {
    const ws = workspace("spawn-fast");
    const file = landed(await write({ sid: "a6", ws }, ".repo/roadmaps/x.md", ROADMAP)).file;
    plant(file, { status: "draft", strategy: "spawn-deep" });
    const { text } = landed(await write({ sid: "a6", ws }, ".repo/plans/x.md", PLAN));
    expect(strategyLines(text)).toStrictEqual(["strategy: spawn-fast"]);
  });

  it("takes the config default with no session value and no roadmap", async () => {
    const { text } = landed(await write({ sid: "a7", ws: workspace("spawn-fast") }, ".repo/plans/x.md", PLAN));
    expect(strategyLines(text)).toStrictEqual(["strategy: spawn-fast"]);
  });

  it("takes free with no session value, no roadmap and no config", async () => {
    const { text } = landed(await write({ sid: "a8", ws: workspace() }, ".repo/plans/x.md", PLAN));
    expect(strategyLines(text)).toStrictEqual(["strategy: free"]);
    expect(text).toContain(`strategy: free\n${ADVICE}\n`);
  });
});

describe("a fresh roadmap takes its strategy from the session, the config, then free", () => {
  it("takes the session value", async () => {
    const ws = workspace("spawn-fast");
    await set(ws, "b1", "spawn-deep");
    const { text } = landed(await write({ sid: "b1", ws }, ".repo/roadmaps/x.md", ROADMAP));
    expect(strategyLines(text)).toStrictEqual(["strategy: spawn-deep"]);
    expect(text).toContain(`strategy: spawn-deep\n${ADVICE}\n`);
  });

  it("skips the roadmap step: an in-progress roadmap's strategy does not reach it", async () => {
    const ws = workspace("spawn-fast");
    await inProgressRoadmap(ws, "b2", "spawn-deep");
    const { text } = landed(await write({ sid: "b2", ws }, ".repo/roadmaps/y.md", ROADMAP));
    expect(strategyLines(text)).toStrictEqual(["strategy: spawn-fast"]);
  });

  it("takes free with no session value and no config", async () => {
    const { text } = landed(await write({ sid: "b3", ws: workspace() }, ".repo/roadmaps/x.md", ROADMAP));
    expect(strategyLines(text)).toStrictEqual(["strategy: free"]);
  });
});
