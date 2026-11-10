import { expect, it } from "vitest";
import plugin from "./index.ts";

it("is the plugin `repo` with the nineteen rules the generated config turns on", () => {
  expect(plugin.meta.name).toBe("repo");
  expect(Object.keys(plugin.rules).sort()).toEqual([
    "as-needs-reason",
    "boundaries",
    "class-file",
    "config-file",
    "deprecated-replacement",
    "entry-file",
    "env-in-config",
    "filename-matches-export",
    "index-file",
    "no-commented-out-code",
    "no-mock-of-subject",
    "no-module-side-effects",
    "no-module-state",
    "no-side-effect-import",
    "no-v8-ignore",
    "public-jsdoc",
    "skip-on-platform",
    "todo-needs-id",
    "types-file",
  ]);
});
