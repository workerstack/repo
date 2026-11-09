import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { CONFIG_FILE, loadConfig } from "./config.ts";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A temp repo root holding `body` as the default export of workerstack.config.ts. */
function repo(body: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-config-tdd-"));
  temps.push(root);
  fs.writeFileSync(path.join(root, CONFIG_FILE), `export default ${body}\n`);
  return root;
}

const refusal = (message: string) => ({ ok: false, errors: [`workerstack.config.ts: ${message}`] });

it("resolves tdd: true", async () => {
  expect(await loadConfig(repo("{ tdd: true }"))).toMatchObject({ ok: true, config: { tdd: true } });
});

it("resolves tdd to false when the config omits it", async () => {
  expect(await loadConfig(repo("{}"))).toMatchObject({ ok: true, config: { tdd: false } });
});

it.each(['"yes"', "1", "null"])("refuses tdd: %s and names tdd", async (value) => {
  expect(await loadConfig(repo(`{ tdd: ${value} }`))).toEqual(refusal("tdd: must be true or false"));
});

it.each(['["docs"]', "[]"])("refuses tdd without the standards pack (packs %s)", async (list) => {
  expect(await loadConfig(repo(`{ packs: ${list}, tdd: true }`))).toEqual(
    refusal('tdd: set only with the standards pack; add "standards" to packs or delete tdd'),
  );
});

it("accepts tdd with the standards pack listed", async () => {
  expect(await loadConfig(repo('{ packs: ["standards"], tdd: true }'))).toMatchObject({
    ok: true,
    config: { tdd: true },
  });
});
