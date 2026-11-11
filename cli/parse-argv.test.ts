import { expect, it } from "vitest";

import { parseArgv } from "./parse-argv.ts";

it("pair, equals, and none", () => {
  expect(parseArgv(["init", "--packs", "speak,listen"])).toMatchObject({
    cmd: "init",
    packs: ["listen", "speak"],
    packsError: false,
  });
  expect(parseArgv(["init", "--packs=google-workspace,clasp"])).toMatchObject({
    packs: ["google-workspace", "clasp"],
    packsError: false,
  });
  expect(parseArgv(["init", "--packs", "none"])).toMatchObject({ packs: [], packsError: false });
  expect(parseArgv(["init", "--packs="])).toMatchObject({ packs: [], packsError: false });
});

it("missing, flag, and unknown are packsError", () => {
  expect(parseArgv(["init", "--packs"])).toMatchObject({ packsError: true });
  expect(parseArgv(["init", "--packs", "--yes"])).toMatchObject({ packsError: true });
  expect(parseArgv(["init", "--packs", "nope"])).toMatchObject({ packsError: true });
  expect(parseArgv(["init", "--packs=nope"])).toMatchObject({ packsError: true });
});

it("splits the command from its arguments and drops the flags it reads", () => {
  expect(parseArgv(["--yes", "map", "-y", "packages/web", "--skip-globals"])).toStrictEqual({
    args: ["packages/web"],
    cmd: "map",
    packs: undefined,
    packsError: false,
    skipGlobals: true,
  });
});

it("takes the value after --packs as the list, never as the command", () => {
  expect(parseArgv(["--packs", "listen", "init"])).toStrictEqual({
    args: [],
    cmd: "init",
    packs: ["listen"],
    packsError: false,
    skipGlobals: false,
  });
});
