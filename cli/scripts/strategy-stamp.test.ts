import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { activeReview, parseApproval, parseClosingLine, stampPath, writeStamp } from "./strategy.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmpRoot() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "strategy-stamp-")));
  dirs.push(dir);
  return dir;
}

function stampWith(root: string, sid: string, body: string) {
  fs.mkdirSync(path.dirname(stampPath(root, sid)), { recursive: true });
  fs.writeFileSync(stampPath(root, sid), body);
}

describe("activeReview on odd stamps and plans", () => {
  it("is null when the stamp is not an object or names no string plan", () => {
    const root = tmpRoot();
    for (const [i, body] of ["5", "null", "{}", '{"plan": 7}'].entries()) {
      stampWith(root, `s${i}`, body);
      expect(activeReview(root, `s${i}`)).toBeNull();
    }
  });

  it("is null when the plan has no frontmatter", () => {
    const root = tmpRoot();
    const plan = path.join(root, "plan.md");
    fs.writeFileSync(plan, "# no frontmatter\n");
    writeStamp(root, "s1", plan);
    expect(activeReview(root, "s1")).toBeNull();
  });

  it("skips frontmatter lines that are not key: value", () => {
    const root = tmpRoot();
    const plan = path.join(root, "plan.md");
    fs.writeFileSync(plan, "---\n# note\n\nserial: 3\nstatus: in-progress\nstrategy: review-deep\n---\n");
    writeStamp(root, "s1", plan);
    expect(activeReview(root, "s1")).toStrictEqual({ plan, serial: 3, strategy: "review-deep" });
  });
});

describe("writeStamp failure", () => {
  it("leaves no temp file and rethrows when the stamp cannot be replaced", () => {
    const root = tmpRoot();
    const dest = stampPath(root, "s1");
    fs.mkdirSync(path.join(dest, "keep"), { recursive: true });
    expect(() => writeStamp(root, "s1", path.join(root, "plan.md"))).toThrow();
    expect(fs.readdirSync(path.dirname(dest))).toStrictEqual(["strategy.json"]);
  });
});

describe("parsers on non-string input", () => {
  it("reads nothing from a missing line or prompt", () => {
    expect(parseClosingLine(undefined as unknown /* a caller may pass a missing line */ as string)).toBeNull();
    expect(parseApproval(undefined as unknown /* a caller may pass a missing prompt */ as string)).toBeNull();
  });
});
