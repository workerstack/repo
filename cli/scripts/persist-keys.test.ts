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
    expect(extractStrategy("---\nstrategy: spawn-fast\n---\n# x")).toBe("spawn-fast");
    expect(extractStrategy("# x\nstrategy: free\n")).toBe("free");
    expect(extractMode("---\nname: x\n---\nmode:   away \n")).toBe("away");
    expect(extractMode("---\nname: x\n---\n# x")).toBeUndefined();
    expect(extractMode("---\nunterminated\nmode: ask")).toBe("ask");
  });

  it("ignores a key line inside a code fence", () => {
    const text = "# x\n```\nmode: away\n```\n";
    expect(extractMode(text)).toBeUndefined();
    expect(stripModeLine(text)).toBe(text);
  });

  it("strips the first key line outside a fence", () => {
    expect(stripStrategyLine("a\nstrategy: free\nb")).toBe("a\nb");
    expect(stripModeLine("a\nmode: ask\nmode: away\nb")).toBe("a\nmode: away\nb");
  });

  it("names the allowed values", () => {
    expect(strategyError()).toBe("strategy: free|spawn-fast|spawn-deep");
    expect(modeErrors({})).toStrictEqual([]);
    expect(modeErrors({ mode: "away" })).toStrictEqual([]);
    expect(modeErrors({ mode: "auto" })).toStrictEqual(["mode: ask|away"]);
    expect(modeErrors({ mode: "" })).toStrictEqual(["mode: ask|away"]);
  });
});
