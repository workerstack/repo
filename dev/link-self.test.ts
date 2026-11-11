import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { encodeBunx, linkAndSync, linkSelf, shebangOf } from "./link-self.ts";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { force: true, recursive: true });
});

function root(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "self-link-"));
  temps.push(dir);
  fs.mkdirSync(path.join(dir, "bin"));
  fs.writeFileSync(path.join(dir, "bin", "repo.ts"), "bin\n");
  fs.mkdirSync(path.join(dir, "references"));
  fs.writeFileSync(path.join(dir, "references", "x.md"), "ref\n");
  return dir;
}

/** A root as `bun install` leaves it: on win32 bun has put its generic shim in `.bin`, which the self-link copies. */
function installedRoot(): string {
  const dir = root();
  if (process.platform === "win32") {
    fs.mkdirSync(path.join(dir, "node_modules", ".bin"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules", ".bin", "alpha.exe"), "ALPHA");
  }
  return dir;
}

const binOf = (dir: string) => path.join(dir, "node_modules", ".bin", "repo");
const pkgOf = (dir: string) => path.join(dir, "node_modules", "@workerstack", "repo");
/** What the linked bin runs: the link's target text, or on win32 "bin\n" once the `.bunx` beside the shim exists. */
const boundText = (dir: string): string => {
  if (process.platform !== "win32") return fs.readFileSync(binOf(dir), "utf8");
  return fs.existsSync(path.join(path.dirname(binOf(dir)), "repo.bunx")) ? "bin\n" : "no bunx";
};
const refOf = (dir: string) => fs.readFileSync(path.join(pkgOf(dir), "references", "x.md"), "utf8");

// Windows runs the bin through a shim pair, not a link; "linkSelf bin on win32" below covers that.
describe("linkSelf bin", () => {
  it.skipIf(process.platform === "win32")("links the bin so it reads as bin/repo.ts, then leaves it", () => {
    const dir = root();
    expect(linkSelf(dir).bin).toBe("linked");
    expect(fs.readFileSync(binOf(dir), "utf8")).toBe("bin\n");
    expect(linkSelf(dir).bin).toBe("current");
  });

  it.skipIf(process.platform === "win32")("replaces a wrong link or a plain file", () => {
    const dir = root();
    fs.mkdirSync(path.dirname(binOf(dir)), { recursive: true });
    fs.symlinkSync("elsewhere", binOf(dir));
    expect(linkSelf(dir).bin).toBe("linked");
    fs.rmSync(binOf(dir));
    fs.writeFileSync(binOf(dir), "stale");
    expect(linkSelf(dir).bin).toBe("linked");
    expect(fs.readFileSync(binOf(dir), "utf8")).toBe("bin\n");
  });
});

describe("linkSelf pkg", () => {
  it("links the package to the root, then leaves it", () => {
    const dir = installedRoot();
    expect(linkSelf(dir).pkg).toBe("linked");
    expect(refOf(dir)).toBe("ref\n");
    expect(linkSelf(dir).pkg).toBe("current");
  });

  it("replaces a wrong link or a plain dir", () => {
    const dir = installedRoot();
    fs.mkdirSync(path.dirname(pkgOf(dir)), { recursive: true });
    fs.symlinkSync("elsewhere", pkgOf(dir));
    expect(linkSelf(dir).pkg).toBe("linked");
    fs.rmSync(pkgOf(dir));
    fs.mkdirSync(pkgOf(dir));
    fs.writeFileSync(path.join(pkgOf(dir), "stale"), "x");
    expect(linkSelf(dir).pkg).toBe("linked");
    expect(refOf(dir)).toBe("ref\n");
  });
});

describe("linkAndSync", () => {
  it("links, then runs the postinstall sync in the root and passes its exit code on", () => {
    const dir = installedRoot();
    const calls: string[] = [];
    const run = (cwd: string) => {
      calls.push(cwd, boundText(dir));
      return 1;
    };
    expect(linkAndSync(dir, run)).toBe(1);
    expect(calls).toStrictEqual([dir, "bin\n"]);
    expect(linkAndSync(dir, () => 0)).toBe(0);
  });
});

// The expected bytes are written out from the layout in bun-v1.4.4 src/install/windows-shim/BinLinkingShim.rs
// (header lines 3-10; Flags::new lines 55-69; encode_into lines 386-463):
// [bin_path utf16]["][0][launcher utf16][space][u32 bin_path bytes][u32 launcher+space bytes][u16 flags], little endian.
const units = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));
const u16 = (n: number): number[] => [n & 0xff, n >> 8];
const u32 = (n: number): number[] => [...u16(n & 0xffff), ...u16(n >>> 16)];
const wide = (list: number[]): number[] => list.flatMap(u16);

/** Version 2739 (VersionFlag::V5) shifted past the four flag bits. */
const VERSION = 2739 << 4;
const NODE_OR_BUN = 1;
const IS_NODE = 2;
const HAS_SHEBANG = 4;
const ABSOLUTE = 8;

describe("shebangOf", () => {
  it("takes the program after env as the launcher and flags bun and node", () => {
    expect(shebangOf("#!/usr/bin/env bun\nx", "..\\bin\\repo.ts")).toStrictEqual({ launcher: "bun", nodeOrBun: true });
    expect(shebangOf("#!/usr/bin/env node\r\nx", "a.js")).toStrictEqual({ launcher: "node", nodeOrBun: true });
    expect(shebangOf("#!/usr/bin/env -S bun --smol\nx", "a.ts")).toStrictEqual({
      launcher: "bun --smol",
      nodeOrBun: true,
    });
    expect(shebangOf("#!/usr/bin/env python3\nx", "a")).toStrictEqual({ launcher: "python3", nodeOrBun: false });
  });

  it("keeps the whole line for a direct interpreter", () => {
    expect(shebangOf("#!/bin/sh -e\nx", "a")).toStrictEqual({ launcher: "/bin/sh -e", nodeOrBun: false });
  });

  it("falls back to the extension when there is no shebang", () => {
    expect(shebangOf("export {}\n", "..\\bin\\repo.ts")).toStrictEqual({ launcher: "bun run", nodeOrBun: true });
    expect(shebangOf("", "x.CMD")).toStrictEqual({ launcher: "cmd /c", nodeOrBun: false });
    expect(shebangOf("data", "x.bin")).toBeNull();
  });
});

describe("encodeBunx", () => {
  it("lays out a relative target run by bun: path, quote, nul, launcher, space, lengths, flags", () => {
    const binPath = "..\\bin\\repo.ts";
    const bytes = encodeBunx(binPath, false, { launcher: "bun", nodeOrBun: true });
    expect([...bytes]).toStrictEqual([
      ...wide(units(binPath)),
      ...wide([34, 0]),
      ...wide(units("bun")),
      ...wide([32]),
      ...u32(binPath.length * 2),
      ...u32(3 * 2 + 2),
      ...u16(VERSION | NODE_OR_BUN | HAS_SHEBANG),
    ]);
    expect(VERSION | NODE_OR_BUN | HAS_SHEBANG).toBe(43829);
  });

  it("sets the absolute and is-node bits; a target with no shebang ends at the flags", () => {
    const abs = encodeBunx("C:\\x\\a.js", true, { launcher: "node", nodeOrBun: true });
    expect([...abs].slice(-2)).toStrictEqual(u16(VERSION | NODE_OR_BUN | IS_NODE | HAS_SHEBANG | ABSOLUTE));
    const bare = encodeBunx("a.exe", false, null);
    expect([...bare]).toStrictEqual([...wide([...units("a.exe"), 34, 0]), ...u16(VERSION)]);
  });
});

describe("linkSelf bin on win32", () => {
  function withShim(): string {
    const dir = root();
    const bin = path.dirname(binOf(dir));
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "zeta.exe"), "ZETA");
    fs.writeFileSync(path.join(bin, "alpha.exe"), "ALPHA");
    fs.writeFileSync(path.join(dir, "bin", "repo.ts"), "#!/usr/bin/env bun\nx\n");
    return dir;
  }

  it("copies the first generic shim to repo.exe and writes repo.bunx for the ts target, then leaves them", () => {
    const dir = withShim();
    expect(linkSelf(dir, "win32").bin).toBe("linked");
    const bin = path.dirname(binOf(dir));
    expect(fs.readFileSync(path.join(bin, "repo.exe"), "utf8")).toBe("ALPHA");
    expect([...fs.readFileSync(path.join(bin, "repo.bunx"))]).toStrictEqual([
      ...encodeBunx("..\\bin\\repo.ts", false, { launcher: "bun", nodeOrBun: true }),
    ]);
    expect(fs.lstatSync(binOf(dir), { throwIfNoEntry: false })).toBeUndefined();
    expect(linkSelf(dir, "win32").bin).toBe("current");
  });

  it("refuses with a clear error when no shim exists to copy", () => {
    const dir = root();
    expect(() => linkSelf(dir, "win32")).toThrow(/no \.exe shim in .*\.bin/);
  });
});
