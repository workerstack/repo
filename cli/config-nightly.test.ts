import { describe, expect, it } from "vitest";

import { loadConfig } from "./config.ts";
import { useBodyRepo } from "./fixtures/body-repo.ts";

const { refusal, repo } = useBodyRepo("nightly");

function withRelease(nightly: string) {
  return repo(`{ packs: ["release"], nightly: ${nightly} }`);
}
const SHARDS_ERROR = "nightly.shards: must be a whole number from 1 to 32";
function secretError(at: number) {
  return `nightly.secrets[${at}]: must be a secret name like CLOUDFLARE_API_TOKEN, not starting with GITHUB_`;
}

describe("nightly", () => {
  it("defaults to one shard and no secrets", async () => {
    expect(await loadConfig(repo("{}"))).toMatchObject({ config: { nightly: { secrets: [], shards: 1 } }, ok: true });
  });

  it("keeps the shards and secrets a release repo sets", async () => {
    const loaded = await loadConfig(withRelease('{ shards: 8, secrets: ["API_TOKEN", "_X1"] }'));
    expect(loaded).toMatchObject({ config: { nightly: { secrets: ["API_TOKEN", "_X1"], shards: 8 } }, ok: true });
  });

  it("fills the shards when only the secrets are set", async () => {
    const loaded = await loadConfig(withRelease('{ secrets: ["A"] }'));
    expect(loaded).toMatchObject({ config: { nightly: { secrets: ["A"], shards: 1 } }, ok: true });
  });

  it.each(["0", "33", "1.5", '"8"'])("refuses shards %s", async (shards) => {
    expect(await loadConfig(withRelease(`{ shards: ${shards} }`))).toStrictEqual(refusal(SHARDS_ERROR));
  });

  it.each(["1", "32"])("accepts shards %s", async (shards) => {
    expect(await loadConfig(withRelease(`{ shards: ${shards} }`))).toMatchObject({ ok: true });
  });

  it.each(['"api_token"', '"GITHUB_TOKEN"', '"1A"', '""', "7"])("refuses the secret %s", async (secret) => {
    expect(await loadConfig(withRelease(`{ secrets: [${secret}] }`))).toStrictEqual(refusal(secretError(0)));
  });

  it("names the index of the bad secret", async () => {
    expect(await loadConfig(withRelease('{ secrets: ["A", "b"] }'))).toStrictEqual(refusal(secretError(1)));
  });
});

describe("nightly secrets", () => {
  it("refuses a duplicate secret with its count", async () => {
    expect(await loadConfig(withRelease('{ secrets: ["A", "B", "A"] }'))).toStrictEqual(
      refusal('nightly.secrets: "A" is listed twice'),
    );
    expect(await loadConfig(withRelease('{ secrets: ["A", "A", "A"] }'))).toStrictEqual(
      refusal('nightly.secrets: "A" is listed 3 times'),
    );
  });

  it("refuses secrets that are not a list and keys it does not know", async () => {
    expect(await loadConfig(withRelease('{ secrets: "A" }'))).toStrictEqual(
      refusal("nightly.secrets: must be a list of secret names"),
    );
    expect(await loadConfig(withRelease("{ cron: 1 }"))).toStrictEqual(refusal('nightly: unknown key "cron"'));
    expect(await loadConfig(withRelease("3"))).toStrictEqual(
      refusal("nightly: must be an object like { shards: 8, secrets: [...] }"),
    );
  });

  it("refuses nightly without the release pack", async () => {
    const message = 'nightly: set only with the release pack; add "release" to packs or delete nightly';
    expect(await loadConfig(repo("{ nightly: { shards: 8 } }"))).toStrictEqual(refusal(message));
    expect(await loadConfig(repo('{ packs: ["docs"], nightly: {} }'))).toStrictEqual(refusal(message));
  });
});
