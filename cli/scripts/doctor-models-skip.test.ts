import fs from "node:fs";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { agentModelsLines } from "./agent-models-lines.ts";
import { tmp } from "./fixtures/doctor-kit.ts";
import { ALL_OFFERED, checkout, codexHome, fakeRun, LISTS, md, OK, rowOf, toml } from "./fixtures/doctor-models-kit.ts";
import type { Reply } from "./fixtures/doctor-models-kit.ts";

const DELAY = 1500;

function slow(stdout: string): Reply {
  return { delay: DELAY, stdout };
}

it("skips a CLI that is not installed", async () => {
  const r = await rowOf(ALL_OFFERED, { replies: { ...OK, "cursor-agent": "not-installed" } });
  expect(r.text).toMatch(/^agent models\s+ok\s+\(skipped: cursor not installed\)$/);
});

it("skips a failing list with the first line of its stderr", async () => {
  const r = await rowOf(ALL_OFFERED, {
    replies: { ...OK, "cursor-agent": { code: 1, stderr: "not signed in\nrun cursor-agent login\n" } },
  });
  expect(r.text).toMatch(/^agent models\s+ok\s+\(skipped: cursor models failed: not signed in\)$/);
});

it("skips a list that exits 0 but names no model", async () => {
  const r = await rowOf(ALL_OFFERED, { replies: { ...OK, grok: { stdout: "You are logged out.\n" } } });
  expect(r.text).toMatch(/\(skipped: grok models failed: no models listed\)$/);
});

it("skips a list that takes over the cap, kills it, and still checks the rest", async () => {
  const r = await rowOf(
    { ...ALL_OFFERED, ".agents/agents/scout.md": md("gemini-3.8-flash-low") },
    { capMs: 100, replies: { ...OK, grok: "hang" } },
  );
  expect(r.lines[0]).toMatch(/^agent models\s+1 to fix\s+\(skipped: grok models took over 0\.1 s\)$/);
  expect(r.lines[1]).toContain(".agents/agents/scout.md: model gemini-3.8-flash-low is not offered by agy");
});

it("names the 20 s cap by default", async () => {
  const cwd = checkout({ ".grok/agents/scout.md": md("grok-4.7") });
  vi.useFakeTimers();
  try {
    const { run } = fakeRun({ grok: "hang" });
    const pending = agentModelsLines({ cwd, env: {}, home: "/nonexistent", run, sourceRoot: cwd });
    await vi.advanceTimersByTimeAsync(20_000);
    const lines = await pending;
    expect(lines.join("\n")).toMatch(/\(skipped: grok models took over 20 s\)$/);
  } finally {
    vi.useRealTimers();
  }
});

it("runs the lists in parallel: two slow lists both finish inside the one cap", async () => {
  const started = Date.now();
  const r = await rowOf(ALL_OFFERED, {
    capMs: 4000,
    replies: { "cursor-agent": slow(LISTS.cursor), grok: slow(LISTS.grok) },
  });
  expect(r.text).toMatch(/^agent models\s+ok\s*$/);
  // In parallel the two lists take about delay plus spawn overhead; one after the other they take at least
  // 2 * delay. That leaves a delay-sized (1.5 s) margin for spawn overhead on a slow runner.
  expect(Date.now() - started).toBeLessThan(2 * DELAY);
});

it("returns within the cap when two lists never answer", async () => {
  const started = Date.now();
  const r = await rowOf(ALL_OFFERED, { capMs: 150, replies: { ...OK, "cursor-agent": "hang", grok: "hang" } });
  expect(Date.now() - started).toBeLessThan(1000);
  expect(r.text).toMatch(/\(skipped: grok models took over 0\.15 s; cursor models took over 0\.15 s\)$/);
});

it("skips codex when the models cache is missing or malformed", async () => {
  const files = { ".codex/agents/scout.toml": toml("gpt-6-luna") };
  const missing = path.join(fs.realpathSync(tmp("doc-models-empty-")), ".codex", "models_cache.json");
  const none = await rowOf(files, { home: path.dirname(path.dirname(missing)) });
  expect(none.text).toMatch(/^agent models\s+ok\s+/);
  expect(none.text).toContain(`(skipped: codex models cache missing at ${missing})`);
  const homes = ["{not json", JSON.stringify({ models: "x" }), JSON.stringify({ models: [] })].map((bad) =>
    codexHome(bad),
  );
  const rows = await Promise.all(homes.map(async (home) => ({ home, r: await rowOf(files, { home }) })));
  for (const { home, r } of rows) {
    expect(r.text).toContain(
      `(skipped: codex models cache malformed at ${path.join(home, ".codex", "models_cache.json")})`,
    );
  }
});
