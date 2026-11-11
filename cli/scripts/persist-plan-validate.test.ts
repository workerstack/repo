import path from "node:path";
import { describe, expect, it } from "vitest";
import { validatePlan, workspacePaths } from "./persist-plan-validate.ts";

describe("workspacePaths", () => {
  const ws = "/home/me/repo";
  const text = "edit /home/me/repo/src/a.ts and cli/scripts/b.ts, then /home/me/repo/docs/c.md";

  it("returns the same paths on two calls in a row", () => {
    const first = workspacePaths(ws, text, path.posix);
    const second = workspacePaths(ws, text, path.posix);
    expect(first).toHaveLength(3);
    expect(second).toStrictEqual(first);
  });

  it("finds every path, not only the first of each kind", () => {
    const found = workspacePaths(ws, text, path.posix);
    expect(found).toContain("/home/me/repo/src/a.ts");
    expect(found).toContain("/home/me/repo/docs/c.md");
    expect(found.some((f) => f.endsWith("cli/scripts/b.ts"))).toBe(true);
  });
});

describe("validatePlan refusals", () => {
  it("names a bad filename and a missing frontmatter together, in that order", () => {
    expect(validatePlan("bad.md", "no frontmatter")).toStrictEqual(["filename", expect.any(String)]);
  });

  it("is the same on two calls in a row", () => {
    const text = "---\nserial: 1\n---\n\n# x\n";
    expect(validatePlan("1-x.md", text)).toStrictEqual(validatePlan("1-x.md", text));
  });
});
