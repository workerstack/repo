import { expect, it } from "vitest";

import { loadConfig } from "./config.ts";
import { refusal, repo, useConfigKit } from "./fixtures/config-kit.ts";

useConfigKit();

/** Usage's tag map: each package's one tag, and the tags each tag may import. */
const BOUNDARIES = {
  allow: { app: ["ui", "lib"], lib: [], ui: ["lib"] },
  tags: { "@app/lib": "lib", "@app/ui": "ui", "@app/web": "app" },
};

/** A standards config whose `lint.boundaries` is `boundaries`. */
function boundariesConfig(boundaries: unknown): string {
  return `export default { packs: ["standards"], lint: { boundaries: ${JSON.stringify(boundaries)} } }\n`;
}

it("lint.boundaries: Usage's tags and allow resolve as written, beside no skips", async () => {
  expect(await loadConfig(repo(boundariesConfig(BOUNDARIES)))).toMatchObject({
    config: { lint: { boundaries: BOUNDARIES, skip: [] } },
    ok: true,
  });
});

it.each([
  [{ ...BOUNDARIES, tags: { "@app/web": 7 } }, 'lint.boundaries.tags.@app/web: must be a tag name like "ui"'],
  [{ ...BOUNDARIES, tags: { "@app/web": "" } }, 'lint.boundaries.tags.@app/web: must be a tag name like "ui"'],
  [{ ...BOUNDARIES, allow: { lib: "ui" } }, "lint.boundaries.allow.lib: must be a list of tag names"],
  [["@app/web"], 'lint.boundaries: must be an object like { tags: { "@app/web": "app" }, allow: { app: [] } }'],
  [{ ...BOUNDARIES, layers: {} }, 'lint.boundaries: unknown key "layers"'],
])("lint.boundaries: refuses %j", async (boundaries, error) => {
  expect(await loadConfig(repo(boundariesConfig(boundaries)))).toStrictEqual(refusal(error));
});
