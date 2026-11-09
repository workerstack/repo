import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { linkSelf } from "./link-self.ts";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
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

const binOf = (dir: string) => path.join(dir, "node_modules", ".bin", "repo");
const pkgOf = (dir: string) => path.join(dir, "node_modules", "@workerstack", "repo");
const refOf = (dir: string) => fs.readFileSync(path.join(pkgOf(dir), "references", "x.md"), "utf8");

describe("linkSelf bin", () => {
  it("links the bin so it reads as bin/repo.ts, then leaves it", () => {
    const dir = root();
    expect(linkSelf(dir).bin).toBe("linked");
    expect(fs.readFileSync(binOf(dir), "utf8")).toBe("bin\n");
    expect(linkSelf(dir).bin).toBe("current");
  });

  it("replaces a wrong link or a plain file", () => {
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
    const dir = root();
    expect(linkSelf(dir).pkg).toBe("linked");
    expect(refOf(dir)).toBe("ref\n");
    expect(linkSelf(dir).pkg).toBe("current");
  });

  it("replaces a wrong link or a plain dir", () => {
    const dir = root();
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
