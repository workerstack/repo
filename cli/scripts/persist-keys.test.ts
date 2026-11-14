import { describe, expect, it } from "vitest";

import {
  extractApproval,
  extractStrategy,
  approvalErrors,
  strategyError,
  stripApprovalLine,
  stripStrategyLine,
} from "./persist-keys.ts";

describe("strategy and approval keys", () => {
  it("reads the value from the frontmatter or a body line", () => {
    expect(extractStrategy("---\nstrategy: spawn-fast\n---\n# x")).toBe("spawn-fast");
    expect(extractStrategy("# x\nstrategy: free\n")).toBe("free");
    expect(extractApproval("---\nname: x\n---\napproval:   away \n")).toBe("away");
    expect(extractApproval("---\nname: x\n---\n# x")).toBeUndefined();
    expect(extractApproval("---\nunterminated\napproval: ask")).toBe("ask");
  });

  it("ignores a key line inside a code fence", () => {
    const text = "# x\n```\napproval: away\n```\n";
    expect(extractApproval(text)).toBeUndefined();
    expect(stripApprovalLine(text)).toBe(text);
  });

  it("strips the first key line outside a fence", () => {
    expect(stripStrategyLine("a\nstrategy: free\nb")).toBe("a\nb");
    expect(stripApprovalLine("a\napproval: ask\napproval: away\nb")).toBe("a\napproval: away\nb");
  });

  it("names the allowed values", () => {
    expect(strategyError()).toBe("strategy: free|spawn-fast|spawn-deep");
    expect(approvalErrors({})).toStrictEqual([]);
    expect(approvalErrors({ approval: "away" })).toStrictEqual([]);
    expect(approvalErrors({ approval: "auto" })).toStrictEqual(["approval: ask|away"]);
    expect(approvalErrors({ approval: "" })).toStrictEqual(["approval: ask|away"]);
  });

  it("refuses the old mode key and says what replaced it", () => {
    expect(approvalErrors({ mode: "away" })).toStrictEqual(["mode: is now approval:; use approval: ask|away"]);
  });
});
