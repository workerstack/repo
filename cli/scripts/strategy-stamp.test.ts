import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempTree } from "../__fixtures__/temp-tree.ts";
import { activeReview, stampPath, writeStamp } from "./strategy.ts";

const tree = useTempTree("strategy-stamp-");

/** An empty temp dir, by its real path. */
function tmpRoot() {
  return fs.realpathSync(tree({}));
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
    fs.writeFileSync(plan, "---\n# note\n\nserial: 3\nstatus: in-progress\nstrategy: spawn-deep\n---\n");
    writeStamp(root, "s1", plan);
    expect(activeReview(root, "s1")).toStrictEqual({ plan, serial: 3, strategy: "spawn-deep" });
  });
});

describe("writeStamp failure", () => {
  it("leaves no temp file and rethrows when the stamp cannot be replaced", () => {
    const root = tmpRoot();
    const dest = stampPath(root, "s1");
    fs.mkdirSync(path.join(dest, "keep"), { recursive: true });
    expect(() => writeStamp(root, "s1", path.join(root, "plan.md"))).toThrow(/rename/);
    expect(fs.readdirSync(path.dirname(dest))).toStrictEqual(["strategy.json"]);
  });
});
