import { describe, expect, it } from "vitest";

import { fenceFirst, openFence, usePlanRules } from "./__fixtures__/persist-plan-rules-kit.ts";
import { validatePlan } from "./persist-plan-validate.ts";

const { errorsFor, saved } = usePlanRules();

describe("validatePlan required keys", () => {
  it("accepts the saved plan and denies a filename outside the pattern", () => {
    const { filename, text } = saved();
    expect(validatePlan(filename, text)).toStrictEqual([]);
    expect(validatePlan("Plan One.md", text)).toContain("filename");
  });

  it("names a missing or unterminated frontmatter and stops there", () => {
    const { filename } = saved();
    expect(validatePlan(filename, "# add-tmp-ignore\n")).toStrictEqual(["missing frontmatter"]);
    expect(validatePlan(filename, "---\nserial: 1\n")).toStrictEqual(["unterminated frontmatter"]);
  });

  it("denies a serial line that is not a positive whole number", () => {
    expect(errorsFor((t) => t.replace("serial: 1", "serial: 0"))).toContain("serial line");
  });

  it("denies a missing or empty required key", () => {
    expect(errorsFor((t) => t.replace(/^name: .*\n/m, ""))).toContain("missing name");
    expect(errorsFor((t) => t.replace(/^source: .*$/m, "source:"))).toContain("missing source");
  });

  it("denies a status outside ready, in-progress, done and blocked", () => {
    expect(errorsFor((t) => t.replace("status: ready", "status: paused"))).toContain("status");
  });

  it("denies a created stamp that is not a date or UTC datetime", () => {
    expect(errorsFor((t) => t.replace(/^created: .*$/m, "created: yesterday"))).toContain("created");
  });
});

describe("validatePlan consistency rules", () => {
  it("denies a source over 120 characters", () => {
    const long = JSON.stringify("s".repeat(121));
    expect(errorsFor((t) => t.replace(/^source: .*$/m, `source: ${long}`))).toContain("source length");
  });

  it("denies a commit subject that is not a conventional commit", () => {
    expect(errorsFor((t) => t.replace("---\n\n#", "commit: Add things.\n---\n\n#"))).toContain("commit");
  });

  it("skips frontmatter lines that are not keys and keeps a quoted value that is not JSON", () => {
    const errors = errorsFor((t) =>
      t.replace(/^source: .*$/m, 'Not a key line\nsource: "bad \\q escape"').replace("reviews: 0", "reviews: 0"),
    );
    expect(errors).toStrictEqual([]);
  });

  it("denies a name that differs from the filename slug and from the title", () => {
    const errors = errorsFor((t) => t.replace("name: add-tmp-ignore", "name: other"));
    expect(errors).toContain("name/filename slug");
    expect(errors).toContain("h1 slug");
  });

  it("denies a serial that differs from the filename prefix", () => {
    const { filename, text } = saved();
    expect(validatePlan(filename.replace(/^1-/, "2-"), text)).toContain("serial/filename");
  });

  it("denies an unclosed code fence before any section rule", () => {
    expect(fenceFirst(errorsFor(openFence))).toBe(true);
  });
});
