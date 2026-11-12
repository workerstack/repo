import { describe, expect, it } from "vitest";

import { COVERAGE, repo, useConfigKit } from "./__fixtures__/config-kit.ts";
import { loadConfig } from "./config.ts";

useConfigKit();

/** The errors of a config whose `coverage` section is `body`; none when it loads. */
async function errors(body: string): Promise<readonly string[]> {
  const loaded = await loadConfig(repo(`export default { coverage: { ${body} } }\n`));

  return loaded.ok ? [] : loaded.errors;
}

describe("coverage", () => {
  it("defaults the floors and known-failures files, with coverage omitted or empty", async () => {
    const expected = { config: { coverage: COVERAGE }, ok: true };
    expect(await loadConfig(repo("export default {}\n"))).toMatchObject(expected);
    expect(await loadConfig(repo("export default { coverage: {} }\n"))).toMatchObject(expected);
  });

  it("takes each path as given and defaults the other", async () => {
    const floors = await loadConfig(repo('export default { coverage: { floors: "ratchets/floors.json" } }\n'));
    expect(floors).toMatchObject({ config: { coverage: { ...COVERAGE, floors: "ratchets/floors.json" } }, ok: true });
    const failures = await loadConfig(repo('export default { coverage: { knownFailures: "ratchets/kf.json" } }\n'));
    expect(failures).toMatchObject({
      config: { coverage: { ...COVERAGE, knownFailures: "ratchets/kf.json" } },
      ok: true,
    });
  });

  it("refuses an unknown key and a path that is not text", async () => {
    expect(await loadConfig(repo("export default { coverage: { floor: 'a.json' } }\n"))).toStrictEqual({
      errors: ['workerstack.config.ts: coverage: unknown key "floor"'],
      ok: false,
    });
    expect(await loadConfig(repo("export default { coverage: { floors: 5 } }\n"))).toStrictEqual({
      errors: ["workerstack.config.ts: coverage.floors: must be a file path like coverage-floors.json"],
      ok: false,
    });
  });
});

describe("coverage, mutation", () => {
  it("takes the globs to mutate and the mutation floors path as given", async () => {
    const source = 'export default { coverage: { mutate: ["cli/**/*.ts", "lib/*.ts"], mutationFloors: "m/f.json" } }\n';
    expect(await loadConfig(repo(source))).toMatchObject({
      config: { coverage: { ...COVERAGE, mutate: ["cli/**/*.ts", "lib/*.ts"], mutationFloors: "m/f.json" } },
      ok: true,
    });
  });

  it("refuses an empty glob list, a glob that is not text and a floors path that is not text", async () => {
    expect(await errors("mutate: []")).toStrictEqual([
      'workerstack.config.ts: coverage.mutate: must be a non-empty list of globs like ["src/**/*.ts"]',
    ]);
    expect(await errors("mutate: [5]")).toStrictEqual([
      'workerstack.config.ts: coverage.mutate[0]: must be a non-empty list of globs like ["src/**/*.ts"]',
    ]);
    expect(await errors("mutationFloors: 5")).toStrictEqual([
      "workerstack.config.ts: coverage.mutationFloors: must be a file path like coverage-floors.json",
    ]);
  });
});
