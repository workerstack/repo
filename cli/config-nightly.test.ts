import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_FILE, loadConfig } from "./config.ts";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A temp repo root holding `body` as the default export of workerstack.config.ts. */
function repo(body: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-config-nightly-"));
  temps.push(root);
  fs.writeFileSync(path.join(root, CONFIG_FILE), `export default ${body}\n`);
  return root;
}

const withRelease = (nightly: string) => repo(`{ packs: ["release"], nightly: ${nightly} }`);
const refusal = (message: string) => ({ ok: false, errors: [`workerstack.config.ts: ${message}`] });
const SHARDS_ERROR = "nightly.shards: must be a whole number from 1 to 32";
const SECRET_ERROR = (at: number) =>
  `nightly.secrets[${at}]: must be a secret name like CLOUDFLARE_API_TOKEN, not starting with GITHUB_`;

describe("nightly", () => {
  it("defaults to one shard and no secrets", async () => {
    expect(await loadConfig(repo("{}"))).toMatchObject({ ok: true, config: { nightly: { shards: 1, secrets: [] } } });
  });

  it("keeps the shards and secrets a release repo sets", async () => {
    const loaded = await loadConfig(withRelease('{ shards: 8, secrets: ["API_TOKEN", "_X1"] }'));
    expect(loaded).toMatchObject({ ok: true, config: { nightly: { shards: 8, secrets: ["API_TOKEN", "_X1"] } } });
  });

  it("fills the shards when only the secrets are set", async () => {
    const loaded = await loadConfig(withRelease('{ secrets: ["A"] }'));
    expect(loaded).toMatchObject({ ok: true, config: { nightly: { shards: 1, secrets: ["A"] } } });
  });

  it.each(["0", "33", "1.5", '"8"'])("refuses shards %s", async (shards) => {
    expect(await loadConfig(withRelease(`{ shards: ${shards} }`))).toEqual(refusal(SHARDS_ERROR));
  });

  it.each(["1", "32"])("accepts shards %s", async (shards) => {
    expect(await loadConfig(withRelease(`{ shards: ${shards} }`))).toMatchObject({ ok: true });
  });

  it.each(['"api_token"', '"GITHUB_TOKEN"', '"1A"', '""', "7"])("refuses the secret %s", async (secret) => {
    expect(await loadConfig(withRelease(`{ secrets: [${secret}] }`))).toEqual(refusal(SECRET_ERROR(0)));
  });

  it("names the index of the bad secret", async () => {
    expect(await loadConfig(withRelease('{ secrets: ["A", "b"] }'))).toEqual(refusal(SECRET_ERROR(1)));
  });
});

describe("nightly secrets", () => {
  it("refuses a duplicate secret with its count", async () => {
    expect(await loadConfig(withRelease('{ secrets: ["A", "B", "A"] }'))).toEqual(
      refusal('nightly.secrets: "A" is listed twice'),
    );
    expect(await loadConfig(withRelease('{ secrets: ["A", "A", "A"] }'))).toEqual(
      refusal('nightly.secrets: "A" is listed 3 times'),
    );
  });

  it("refuses secrets that are not a list and keys it does not know", async () => {
    expect(await loadConfig(withRelease('{ secrets: "A" }'))).toEqual(
      refusal("nightly.secrets: must be a list of secret names"),
    );
    expect(await loadConfig(withRelease("{ cron: 1 }"))).toEqual(refusal('nightly: unknown key "cron"'));
    expect(await loadConfig(withRelease("3"))).toEqual(
      refusal("nightly: must be an object like { shards: 8, secrets: [...] }"),
    );
  });

  it("refuses nightly without the release pack", async () => {
    const message = 'nightly: set only with the release pack; add "release" to packs or delete nightly';
    expect(await loadConfig(repo("{ nightly: { shards: 8 } }"))).toEqual(refusal(message));
    expect(await loadConfig(repo('{ packs: ["docs"], nightly: {} }'))).toEqual(refusal(message));
  });
});
