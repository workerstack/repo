import { describe, expect, it } from "vitest";
import { readGoldens, renderFixtureTrees } from "../../dev/capture-tree-goldens.ts";

// One render spawns rulesync three times, about 2.5s each on a CI runner.
const RENDER_TIMEOUT = 60_000;

// Regenerate only with `bun dev/capture-tree-goldens.ts`; a diff here is a byte a host would read differently.
describe("agent trees of the consumer fixture over the frozen stock", { timeout: RENDER_TIMEOUT }, () => {
  it("render exactly the golden files, byte for byte", async () => {
    const rendered = await renderFixtureTrees();
    const goldens = readGoldens();
    expect([...rendered.keys()]).toStrictEqual([...goldens.keys()]);
    for (const [rel, content] of goldens) expect(rendered.get(rel), rel).toBe(content);
  });
});
