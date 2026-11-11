import { expect, it } from "vitest";

import { parseArgv } from "./sync-pstack-args.ts";

it("parseArgv defaults generate on", () => {
  expect(parseArgv([])).toStrictEqual({
    check: false,
    generate: true,
    ok: true,
    ref: "main",
    repo: "backnotprop/pstack",
    skills: [],
  });
});

it("parseArgv parses flags", () => {
  expect(parseArgv(["--check", "--no-generate", "--ref", "abc", "--skill", "bro", "--skill", "teach"])).toStrictEqual({
    check: true,
    generate: false,
    ok: true,
    ref: "abc",
    repo: "backnotprop/pstack",
    skills: ["bro", "teach"],
  });
});

it("parseArgv rejects unknown flags", () => {
  expect(parseArgv(["--wat"])).toStrictEqual({ error: "unknown flag: --wat", ok: false });
});

it("parseArgv rejects a flag with no value", () => {
  expect(parseArgv(["--ref"])).toStrictEqual({ error: "--ref needs a value", ok: false });
  expect(parseArgv(["--skill", "--check"])).toStrictEqual({ error: "--skill needs a value", ok: false });
});
