import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { useTempTree } from "../__fixtures__/temp-tree.ts";
import { fixPasses } from "./fix-passes.ts";
import { captureTool } from "./lint.ts";
import { MAX_FIX_PASSES } from "./max-fix-passes.constants.ts";

const SLOW = 60_000;
const tree = useTempTree("workerstack-fix-passes-");

/** no-else-return's fix drops the `else`, after which require-readable-spacing wants a blank line before the return. */
const INTERACTING = {
  ".oxlintrc.jsonc": JSON.stringify({
    categories: { correctness: "off" },
    jsPlugins: [{ name: "repo", specifier: "@workerstack/repo/lint" }],
    plugins: ["eslint"],
    rules: { "eslint/no-else-return": "error", "repo/require-readable-spacing": "error" },
  }),
  "package.json": '{ "name": "app", "private": true, "type": "module" }\n',
  "src/a.ts": "export function a(n: number) {\n  if (n > 0) {\n    return n;\n  } else {\n    return 0;\n  }\n}\n",
};

/** Both fixes, the indent oxlint leaves as it was: bun fmt, which `repo turn` runs after, sets it. */
const FIXED = "export function a(n: number) {\n  if (n > 0) {\n    return n;\n  }\n\n    return 0;\n  \n}\n";

function read(root: string): string {
  return fs.readFileSync(path.join(root, "src/a.ts"), "utf8");
}

it(
  "one oxlint --fix pass leaves the hit its own fix made; the passes rerun it to the fully fixed text",
  {
    timeout: SLOW,
  },
  () => {
    const once = tree(INTERACTING);
    captureTool("oxlint", ["--fix", "src/a.ts"], { root: once });
    expect(read(once)).toBe(FIXED.replace("}\n\n", "}\n"));
    const root = tree(INTERACTING);
    const last = fixPasses(root, ["src/a.ts"], () => captureTool("oxlint", ["--fix", "src/a.ts"], { root }));
    expect(read(root)).toBe(FIXED);
    expect(last.code).toBe(0);
  },
);

it("stops after MAX_FIX_PASSES when every pass rewrites a file, and after one when none does", () => {
  const root = tree({ "a.ts": "" });
  const runs: number[] = [];

  function grow() {
    fs.appendFileSync(path.join(root, "a.ts"), "x");
    runs.push(runs.length);

    return runs.length;
  }

  expect(fixPasses(root, ["a.ts", "gone.ts"], grow)).toBe(MAX_FIX_PASSES);
  expect(fixPasses(root, ["a.ts"], () => "same")).toBe("same");
});
