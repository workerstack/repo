import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { cleanTemps, consumer, SLOW } from "./__fixtures__/baseline-repo.ts";
import { spies } from "./__fixtures__/lint-scripts-kit.ts";
import { lintMain } from "./lint-main.ts";

const saved = process.cwd();

afterEach(() => {
  process.chdir(saved);
  vi.restoreAllMocks();
  cleanTemps();
});

/** An oxlint config whose no-else-return fix leaves a blank line for require-readable-spacing's next pass. */
const INTERACTING_RC = JSON.stringify({
  categories: { correctness: "off" },
  jsPlugins: [{ name: "repo", specifier: "@workerstack/repo/lint" }],
  plugins: ["eslint"],
  rules: { "eslint/no-else-return": "error", "repo/require-readable-spacing": "error" },
});

const ELSE_RETURN =
  "export function a(n: number) {\n  if (n > 0) {\n    return n;\n  } else {\n    return 0;\n  }\n}\n";

/** Both fixes applied; oxlint leaves the indent as it was, for oxfmt to set. */
const BOTH_FIXED = "export function a(n: number) {\n  if (n > 0) {\n    return n;\n  }\n\n    return 0;\n  \n}\n";

/** The first pass alone: the `else` dropped, the blank line before the return not yet in. */
const ONE_PASS = BOTH_FIXED.replace("}\n\n", "}\n");

/** A consumer whose `src/a.ts` takes two `--fix` passes; its root and a reader of that file. */
function interacting() {
  const root = consumer({ ".oxlintrc.json": INTERACTING_RC, "src/a.ts": ELSE_RETURN });

  return { read: () => fs.readFileSync(path.join(root, "src/a.ts"), "utf8"), root };
}

it("lint --fix reruns oxlint over the files git lists until a pass rewrites none", { timeout: SLOW }, async () => {
  const { read, root } = interacting();
  spies();
  process.chdir(root);
  expect(await lintMain(["--fix", "--max-warnings", "0", "src/a.ts"])).toBe(0);
  expect(read()).toBe(BOTH_FIXED);
});

it("lint --fix runs a single pass where git lists no files", { timeout: SLOW }, async () => {
  const { read, root } = interacting();
  const dotGit = path.join(root, ".git");
  spies();
  fs.rmSync(dotGit, { force: true, recursive: true });
  fs.writeFileSync(dotGit, "gitdir: missing\n");
  process.chdir(root);
  await lintMain(["--fix", "src/a.ts"]);
  expect(read()).toBe(ONE_PASS);
});
