import os from "node:os";
import { describe, expect, it } from "vitest";
import { parseArgv, resolveHome } from "./purge-paths.ts";

describe("parseArgv", () => {
  it("defaults dry-run; --apply writes", () => {
    expect(parseArgv([])).toEqual({ ok: true, apply: false });
    expect(parseArgv(["--apply"])).toEqual({ ok: true, apply: true });
    expect(parseArgv(["--wat"]).ok).toBe(false);
  });
});

describe("resolveHome", () => {
  it("HOME beats USERPROFILE", () => {
    expect(resolveHome({ HOME: "/unix", USERPROFILE: "C:\\Users\\x" })).toBe("/unix");
  });

  it("USERPROFILE when HOME unset (Windows env sim)", () => {
    expect(resolveHome({ USERPROFILE: "C:\\Users\\win" })).toBe("C:\\Users\\win");
  });

  it("falls back to os.homedir when env empty", () => {
    expect(resolveHome({})).toBe(os.homedir());
  });
});
