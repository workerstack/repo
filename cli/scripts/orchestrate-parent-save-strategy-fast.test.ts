import { describe, expect, it } from "vitest";

import { ADVICE, FRESH_DENY, ROADMAP, saveStrategyKit } from "./__fixtures__/save-strategy-kit.ts";

const { edit, landed, plant, read, set, strategyLines, workspace, write } = saveStrategyKit();

const FAST_PLAN = [
  "FAST_PLAN_NAME: add tmp ignore",
  "commit: chore: ignore .tmp",
  ADVICE,
  "# add-tmp-ignore",
  "",
  "## Goal",
  "Ignore `.tmp/` in git.",
  "",
  "## Steps",
  "1 [ ] add `.tmp/` to `.gitignore`",
  "",
  "## Verify",
  "2 [ ] `git check-ignore .tmp/x` prints it",
  "",
].join("\n");

const FAST_ROADMAP = [
  "FAST_ROADMAP_NAME: tidy ignores",
  ADVICE,
  "# tidy-ignores",
  "",
  "## Order",
  "1 [ ] ignore tmp: add .tmp/ to .gitignore",
  "2 [ ] ignore logs: add *.log to .gitignore",
  "",
  "## Verify",
  "3 [ ] `git check-ignore .tmp/x a.log` prints both",
  "",
].join("\n");

/** A fast roadmap this session saved, then left in progress with `strategy`. */
async function inProgressFast(ws: string, sid: string, strategy: string): Promise<void> {
  const file = landed(await write({ sid, ws }, ".repo/roadmaps-fast/x.md", FAST_ROADMAP)).file;
  plant(file, { status: "in-progress", strategy });
}

describe("a fresh fast plan takes the session value, its fast roadmap's, the config, then free", () => {
  it("takes the session value and writes the advice right after it", async () => {
    const ws = workspace("spawn-deep");
    await set(ws, "f1", "spawn-fast");
    await inProgressFast(ws, "f1", "spawn-deep");
    const { text } = landed(await write({ sid: "f1", ws }, ".repo/plans-fast/x.md", FAST_PLAN));
    expect(strategyLines(text)).toStrictEqual(["strategy: spawn-fast"]);
    expect(text).toContain(`strategy: spawn-fast\n${ADVICE}\n`);
  });

  it("takes the in-progress fast roadmap's over the config", async () => {
    const ws = workspace("spawn-fast");
    await inProgressFast(ws, "f2", "spawn-deep");
    const { text } = landed(await write({ sid: "f2", ws }, ".repo/plans-fast/x.md", FAST_PLAN));
    expect(strategyLines(text)).toStrictEqual(["strategy: spawn-deep"]);
  });

  it("does not take an in-progress deep roadmap's", async () => {
    const ws = workspace("spawn-fast");
    const file = landed(await write({ sid: "f3", ws }, ".repo/roadmaps/x.md", ROADMAP)).file;
    plant(file, { status: "in-progress", strategy: "spawn-deep" });
    const { text } = landed(await write({ sid: "f3", ws }, ".repo/plans-fast/x.md", FAST_PLAN));
    expect(strategyLines(text)).toStrictEqual(["strategy: spawn-fast"]);
  });

  it("takes the config, then free", async () => {
    const config = landed(await write({ sid: "f4", ws: workspace("spawn-fast") }, ".repo/plans-fast/x.md", FAST_PLAN));
    expect(strategyLines(config.text)).toStrictEqual(["strategy: spawn-fast"]);
    const bare = landed(await write({ sid: "f4", ws: workspace() }, ".repo/plans-fast/x.md", FAST_PLAN));
    expect(strategyLines(bare.text)).toStrictEqual(["strategy: free"]);
  });
});

describe("a fresh fast roadmap takes the session value or the config", () => {
  it("takes the session value with the advice after it, and no in-progress fast roadmap's", async () => {
    const ws = workspace();
    await set(ws, "g1", "spawn-deep");
    const { text } = landed(await write({ sid: "g1", ws }, ".repo/roadmaps-fast/x.md", FAST_ROADMAP));
    expect(text).toContain(`strategy: spawn-deep\n${ADVICE}\n`);
    const other = workspace("spawn-fast");
    await inProgressFast(other, "g2", "spawn-deep");
    const next = landed(await write({ sid: "g2", ws: other }, ".repo/roadmaps-fast/y.md", FAST_ROADMAP));
    expect(strategyLines(next.text)).toStrictEqual(["strategy: spawn-fast"]);
  });
});

describe("a fast save guards its strategy as a plan does", () => {
  it("denies a fresh save that sends a strategy other than the one it would get", async () => {
    const ws = workspace();
    const sent = FAST_PLAN.replace(ADVICE, "strategy: spawn-deep");
    const out = await write({ sid: "h1", ws }, ".repo/plans-fast/x.md", sent);
    expect(out?.permissionDecision).toBe("deny");
    expect(out?.permissionDecisionReason).toBe(FRESH_DENY);
    const roadmap = await write({ sid: "h1", ws }, ".repo/roadmaps-fast/x.md", `${FAST_ROADMAP}\nstrategy: free\n`);
    expect(roadmap?.permissionDecision).toBe("deny");
  });

  it("lets a rewrite resend the saved strategy, and denies a Write or Edit that changes it", async () => {
    const ws = workspace();
    const { file } = landed(await write({ sid: "h2", ws }, ".repo/plans-fast/x.md", FAST_PLAN));
    const resent = await write({ sid: "h2", ws }, file, read(file));
    expect(landed(resent).file).toBe(file);
    const changed = await write({ sid: "h2", ws }, file, read(file).replace("strategy: free", "strategy: spawn-fast"));
    expect(changed?.permissionDecisionReason).toBe(FRESH_DENY);
    const edited = await edit({ sid: "h2", ws }, file, { from: "strategy: free", to: "strategy: spawn-deep" });
    expect(edited?.permissionDecisionReason).toBe(FRESH_DENY);
  });
});
