import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { linkSelfBin } from "./link-self-bin.ts";

function root(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "self-bin-"));
  fs.mkdirSync(path.join(dir, "bin"));
  fs.writeFileSync(path.join(dir, "bin", "repo.ts"), "bin\n");
  return dir;
}

const binOf = (dir: string) => path.join(dir, "node_modules", ".bin", "repo");

describe("linkSelfBin", () => {
  it("links the bin so it reads as bin/repo.ts, then leaves it", () => {
    const dir = root();
    expect(linkSelfBin(dir)).toBe("linked");
    expect(fs.readFileSync(binOf(dir), "utf8")).toBe("bin\n");
    expect(linkSelfBin(dir)).toBe("current");
  });

  it("replaces a wrong link or a plain file", () => {
    const dir = root();
    fs.mkdirSync(path.dirname(binOf(dir)), { recursive: true });
    fs.symlinkSync("elsewhere", binOf(dir));
    expect(linkSelfBin(dir)).toBe("linked");
    fs.rmSync(binOf(dir));
    fs.writeFileSync(binOf(dir), "stale");
    expect(linkSelfBin(dir)).toBe("linked");
    expect(fs.readFileSync(binOf(dir), "utf8")).toBe("bin\n");
  });
});
