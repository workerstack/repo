import { expect, it } from "vitest";
import { parseArgv } from "./sync-pstack-args.ts";

it("parseArgv defaults generate on", () => {
  expect(parseArgv([])).toEqual({
    ok: true,
    check: false,
    generate: true,
    ref: "main",
    repo: "backnotprop/pstack",
    skills: [],
  });
});

it("parseArgv parses flags", () => {
  expect(parseArgv(["--check", "--no-generate", "--ref", "abc", "--skill", "bro", "--skill", "teach"])).toEqual({
    ok: true,
    check: true,
    generate: false,
    ref: "abc",
    repo: "backnotprop/pstack",
    skills: ["bro", "teach"],
  });
});

it("parseArgv rejects unknown flags", () => {
  expect(parseArgv(["--wat"])).toEqual({ ok: false, error: "unknown flag: --wat" });
});

it("parseArgv rejects a flag with no value", () => {
  expect(parseArgv(["--ref"])).toEqual({ ok: false, error: "--ref needs a value" });
  expect(parseArgv(["--skill", "--check"])).toEqual({ ok: false, error: "--skill needs a value" });
});
