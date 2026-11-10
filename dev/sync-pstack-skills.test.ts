import { expect, it } from "vitest";
import { capture } from "./sync-pstack-fixtures.ts";
import { main } from "./sync-pstack-skills.ts";

it("main exits 1 with the reason for an unknown flag", async () => {
  const { out, err, io } = capture();
  expect(await main(["--help"], io)).toBe(1);
  expect(out).toEqual([]);
  expect(err).toEqual(["unknown flag: --help\n"]);
});

it("main exits 1 for a flag with no value", async () => {
  const { err, io } = capture();
  expect(await main(["--ref"], io)).toBe(1);
  expect(err).toEqual(["--ref needs a value\n"]);
});

it("main exits 1 naming an unknown skill", async () => {
  const { out, err, io } = capture();
  expect(await main(["--skill", "no-such-skill"], io)).toBe(1);
  expect(out).toEqual([]);
  expect(err).toEqual(["unknown pstack skill: no-such-skill\n"]);
});
