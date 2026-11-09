import { expect, it } from "vitest";
import plugin from "./index.ts";

it("is the plugin `repo` with the five rules the generated config turns on", () => {
  expect(plugin.meta.name).toBe("repo");
  expect(Object.keys(plugin.rules).sort()).toEqual([
    "boundaries",
    "no-module-side-effects",
    "no-module-state",
    "no-side-effect-import",
    "no-v8-ignore",
  ]);
});
