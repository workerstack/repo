import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { CONFIG_FILE } from "./config.constants.ts";
import { loadConfig } from "./config.ts";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { force: true, recursive: true });
});

/** A temp repo root holding `body` as the default export of workerstack.config.ts. */
function repo(body: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-config-knip-"));
  temps.push(root);
  fs.writeFileSync(path.join(root, CONFIG_FILE), `export default ${body}\n`);
  return root;
}

const refusal = (message: string) => ({ errors: [`workerstack.config.ts: ${message}`], ok: false });

it("resolves knip.ignore to none when the config omits knip", async () => {
  expect(await loadConfig(repo("{}"))).toMatchObject({ config: { knip: { ignore: [] } }, ok: true });
});

it("resolves a file, a dependency and a binary ignore", async () => {
  const body = `{ knip: { ignore: [
    { file: "src/old.ts", reason: "loaded by name" },
    { dependency: "oxlint", reason: "spawned by path" },
    { binary: "tsc", reason: "run by a hook" },
  ] } }`;
  expect(await loadConfig(repo(body))).toMatchObject({
    config: {
      knip: {
        ignore: [
          { file: "src/old.ts", reason: "loaded by name" },
          { dependency: "oxlint", reason: "spawned by path" },
          { binary: "tsc", reason: "run by a hook" },
        ],
      },
    },
    ok: true,
  });
});

it.each(['{ file: "a.ts" }', '{ file: "a.ts", reason: "" }'])(
  "refuses the ignore %s without a reason",
  async (entry) => {
    expect(await loadConfig(repo(`{ knip: { ignore: [${entry}] } }`))).toStrictEqual(
      refusal("knip.ignore[0].reason: say why knip cannot see the use"),
    );
  },
);

it.each([
  '{ file: "a.ts", dependency: "x", reason: "why" }',
  '{ file: "a.ts", binary: "x", dependency: "y", reason: "why" }',
  '{ reason: "why" }',
])("refuses the ignore %s naming not exactly one of its keys", async (entry) => {
  expect(await loadConfig(repo(`{ knip: { ignore: [{ file: "ok.ts", reason: "why" }, ${entry}] } }`))).toStrictEqual(
    refusal("knip.ignore[1]: name exactly one of file, dependency or binary"),
  );
});

it.each(['["docs"]', "[]"])("refuses knip without the standards pack (packs %s)", async (list) => {
  expect(await loadConfig(repo(`{ packs: ${list}, knip: {} }`))).toStrictEqual(
    refusal('knip: set only with the standards pack; add "standards" to packs or delete knip'),
  );
});
