import { describe, expect, it } from "vitest";

import { COMMIT, repo, useConfigKit } from "./__fixtures__/config-kit.ts";
import { loadConfig } from "./config.ts";

useConfigKit();

describe("loadConfig", () => {
  it("reads the commit size limit under the standards pack, the default packs included", async () => {
    const limit = { commit: { maxChangedLines: 1500 } };
    expect(
      await loadConfig(repo('export default { packs: ["standards"], commit: { maxChangedLines: 1500 } }\n')),
    ).toMatchObject({ config: limit, ok: true });
    expect(await loadConfig(repo("export default { commit: { maxChangedLines: 1500 } }\n"))).toMatchObject({
      config: limit,
      ok: true,
    });
    expect(await loadConfig(repo('export default { packs: ["standards"], commit: {} }\n'))).toMatchObject({
      config: { commit: COMMIT },
      ok: true,
    });
  });

  it.each(['["docs"]', "[]"])("rejects commit without the standards pack (packs %s)", async (list) => {
    expect(
      await loadConfig(repo(`export default { packs: ${list}, commit: { maxChangedLines: 1500 } }\n`)),
    ).toStrictEqual({
      errors: [
        'workerstack.config.ts: commit: set only with the standards pack; add "standards" to packs or delete commit',
      ],
      ok: false,
    });
  });
});

describe("loadConfig", () => {
  it.each(["0", "-5", "10.5", '"1500"'])("rejects a size limit of %s", async (value) => {
    expect(await loadConfig(repo(`export default { commit: { maxChangedLines: ${value} } }\n`))).toStrictEqual({
      errors: ["workerstack.config.ts: commit.maxChangedLines: must be a whole number of lines above 0"],
      ok: false,
    });
  });

  it("rejects an unknown key under commit, and a commit that is not an object", async () => {
    expect(await loadConfig(repo("export default { commit: { maxLines: 5 } }\n"))).toStrictEqual({
      errors: ['workerstack.config.ts: commit: unknown key "maxLines"'],
      ok: false,
    });
    expect(await loadConfig(repo("export default { commit: 5 }\n"))).toStrictEqual({
      errors: ["workerstack.config.ts: commit: must be an object like { maxChangedLines: 1000 }"],
      ok: false,
    });
  });

  it("rejects an unknown key", async () => {
    expect(await loadConfig(repo("export default { pakcs: [] }\n"))).toStrictEqual({
      errors: ['workerstack.config.ts: unknown key "pakcs"'],
      ok: false,
    });
  });
});

describe("loadConfig", () => {
  it("rejects each unknown key alongside a valid one", async () => {
    expect(await loadConfig(repo('export default { packs: ["docs"], a: 1, b: 2 }\n'))).toStrictEqual({
      errors: ['workerstack.config.ts: unknown key "a"', 'workerstack.config.ts: unknown key "b"'],
      ok: false,
    });
  });

  it("rejects a name that is not a pack", async () => {
    expect(await loadConfig(repo('export default { packs: ["docs", "lint"] }\n'))).toStrictEqual({
      errors: [
        'workerstack.config.ts: packs[1]: "lint" is not a pack; ' +
          "use agents, standards, docs, release, workspace or benchmark",
      ],
      ok: false,
    });
  });

  it("rejects a pack listed twice", async () => {
    expect(await loadConfig(repo('export default { packs: ["docs", "docs"] }\n'))).toStrictEqual({
      errors: ['workerstack.config.ts: packs: "docs" is listed twice'],
      ok: false,
    });
  });
});

describe("loadConfig", () => {
  it("counts a pack listed more than twice", async () => {
    expect(await loadConfig(repo('export default { packs: ["docs", "agents", "docs", "docs"] }\n'))).toStrictEqual({
      errors: ['workerstack.config.ts: packs: "docs" is listed 3 times'],
      ok: false,
    });
  });

  it("rejects packs that are not a list", async () => {
    const result = await loadConfig(repo('export default { packs: "docs" }\n'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^workerstack\.config\.ts: packs: \S/);
  });
});
