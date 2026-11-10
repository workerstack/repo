import { describe, expect, it } from "vitest";
import {
  extractMode,
  extractStrategy,
  modeErrors,
  strategyError,
  stripModeLine,
  stripStrategyLine,
} from "./persist-keys.ts";

describe("strategy and mode keys", () => {
  it("reads the value from the frontmatter or a body line", () => {
    expect(extractStrategy("---\nstrategy: review-fast\n---\n# x")).toBe("review-fast");
    expect(extractStrategy("# x\nstrategy: default\n")).toBe("default");
    expect(extractMode("---\nname: x\n---\nmode:   away \n")).toBe("away");
    expect(extractMode("---\nname: x\n---\n# x")).toBeUndefined();
    expect(extractMode("---\nunterminated\nmode: ask")).toBe("ask");
  });

  it("ignores a key line inside a code fence", () => {
    const text = "# x\n```\nmode: auto\n```\n";
    expect(extractMode(text)).toBeUndefined();
    expect(stripModeLine(text)).toBe(text);
  });

  it("strips the first key line outside a fence", () => {
    expect(stripStrategyLine("a\nstrategy: default\nb")).toBe("a\nb");
    expect(stripModeLine("a\nmode: ask\nmode: auto\nb")).toBe("a\nmode: auto\nb");
  });

  it("names the allowed values", () => {
    expect(strategyError()).toBe("strategy: default|review-fast|review-deep");
    expect(modeErrors({})).toEqual([]);
    expect(modeErrors({ mode: "away" })).toEqual([]);
    expect(modeErrors({ mode: "" })).toEqual(["mode: ask|auto|away"]);
  });
});
