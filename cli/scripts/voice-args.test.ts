import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { removeTemps } from "../__fixtures__/remove-temps.ts";
import { parseArgv, readObjectFile, section, str } from "./voice-args.ts";

const dirs: string[] = [];

function plant(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-args-"));
  dirs.push(dir);
  const file = path.join(dir, "x.json");
  fs.writeFileSync(file, content);

  return file;
}

afterEach(() => {
  removeTemps(dirs.splice(0));
});

describe("parseArgv", () => {
  it("reads verb and flags", () => {
    expect(parseArgv(["rec", "--seconds", "5", "--clip"])).toStrictEqual({
      _: ["rec"],
      flags: { clip: "1", seconds: "5" },
    });
    expect(parseArgv(["say", "--text", "hello", "--provider", "openai"])).toStrictEqual({
      _: ["say"],
      flags: { provider: "openai", text: "hello" },
    });
    expect(parseArgv(["say", "--text", "hi", "--play"])).toStrictEqual({
      _: ["say"],
      flags: { play: "1", text: "hi" },
    });
  });
});

describe("parseArgv separators and filtering", () => {
  it("collects positionals, flags, bare flags and everything after --", () => {
    expect(parseArgv(["say", "--text", "hi", "--play", "--voice", "v", "--", "--raw", "x"])).toStrictEqual({
      _: ["say", "--raw", "x"],
      flags: { play: "1", text: "hi", voice: "v" },
    });
    expect(parseArgv(["rec", "--", "--seconds", "5"])).toStrictEqual({ _: ["rec", "--seconds", "5"], flags: {} });
  });

  it("a flag followed by a flag or nothing is a boolean", () => {
    expect(parseArgv(["--a", "--b", "--c"]).flags).toStrictEqual({ a: "1", b: "1", c: "1" });
    expect(parseArgv(["--a", ""]).flags).toStrictEqual({ a: "1" });
    expect(parseArgv(["---"]).flags).toStrictEqual({ "-": "1" });
  });
});

describe("readObjectFile", () => {
  it("reads an object, and gives an empty one for missing, broken or non-object files", () => {
    expect(readObjectFile(plant('{"a":1}'))).toStrictEqual({ a: 1 });
    expect(readObjectFile(plant("{nope"))).toStrictEqual({});
    expect(readObjectFile(plant("[1]"))).toStrictEqual({});
    expect(readObjectFile(path.join(os.tmpdir(), "voice-args-missing", "x.json"))).toStrictEqual({});
  });
});

describe("str and section", () => {
  it("trims, stringifies and falls back when empty", () => {
    expect(str("  a ")).toBe("a");
    expect(str(undefined)).toBe("");
    expect(str(null, "d")).toBe("d");
    expect(str("   ", "d")).toBe("d");
    expect(str(5)).toBe("5");
  });

  it("section is the object under a key, else an empty one", () => {
    expect(section({ a: { b: 1 } }, "a")).toStrictEqual({ b: 1 });
    expect(section({ a: 4 }, "a")).toStrictEqual({});
    expect(section({}, "a")).toStrictEqual({});
  });
});
