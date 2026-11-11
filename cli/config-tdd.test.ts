import { expect, it } from "vitest";

import { loadConfig } from "./config.ts";
import { useBodyRepo } from "./fixtures/body-repo.ts";

const { refusal, repo } = useBodyRepo("tdd");

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
