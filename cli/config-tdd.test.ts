import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { CONFIG_FILE, loadConfig } from "./config.ts";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { force: true, recursive: true });
});

/** A temp repo root holding `body` as the default export of workerstack.config.ts. */
function repo(body: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-config-tdd-"));
  temps.push(root);
  fs.writeFileSync(path.join(root, CONFIG_FILE), `export default ${body}\n`);
  return root;
}

const refusal = (message: string) => ({ errors: [`workerstack.config.ts: ${message}`], ok: false });

it("resolves tdd: true", async () => {
  expect(await loadConfig(repo("{ tdd: true }"))).toMatchObject({ config: { tdd: true }, ok: true });
});

it("resolves tdd to false when the config omits it", async () => {
  expect(await loadConfig(repo("{}"))).toMatchObject({ config: { tdd: false }, ok: true });
});

it.each(['"yes"', "1", "null"])("refuses tdd: %s and names tdd", async (value) => {
  expect(await loadConfig(repo(`{ tdd: ${value} }`))).toStrictEqual(refusal("tdd: must be true or false"));
});

it.each(['["docs"]', "[]"])("refuses tdd without the standards pack (packs %s)", async (list) => {
  expect(await loadConfig(repo(`{ packs: ${list}, tdd: true }`))).toStrictEqual(
    refusal('tdd: set only with the standards pack; add "standards" to packs or delete tdd'),
  );
});

it("accepts tdd with the standards pack listed", async () => {
  expect(await loadConfig(repo('{ packs: ["standards"], tdd: true }'))).toMatchObject({
    config: { tdd: true },
    ok: true,
  });
});
