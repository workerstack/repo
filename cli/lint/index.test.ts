import { expect, it } from "vitest";

import plugin from "./index.ts";

it("is the plugin `repo` with the twenty-five rules the generated config turns on", () => {
  expect(plugin.meta.name).toBe("repo");
  expect(Object.keys(plugin.rules).toSorted()).toStrictEqual([
    "as-needs-reason",
    "boundaries",
    "class-file",
    "config-file",
    "deprecated-replacement",
    "entry-file",
    "env-in-config",
    "filename-matches-export",
    "index-file",
    "max-line-width",
    "member-ordering",
    "naming-convention",
    "native-path-separator",
    "no-block-comment",
    "no-boolean-param",
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
