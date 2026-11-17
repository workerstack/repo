import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { removeTree } from "../remove-tree.ts";
import { cleanTemps, consumer, nonNull, SLOW } from "./__fixtures__/baseline-repo.ts";
import { spies } from "./__fixtures__/lint-scripts-kit.ts";
import { BASELINE_PATH } from "./lint-baseline.constants.ts";
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

/** Both fixes applied; oxlint leaves the indent as it was, for bun fmt to set. */
const BOTH_FIXED = "export function a(n: number) {\n  if (n > 0) {\n    return n;\n  }\n\n    return 0;\n  \n}\n";

/** The first pass alone: the `else` dropped, the blank line before the return not yet in. */
const ONE_PASS = BOTH_FIXED.replace("}\n\n", "}\n");

/** A consumer whose `src/a.ts` takes two `--fix` passes; its root and a reader of that file. */
function interacting() {
  const root = consumer({ ".oxlintrc.jsonc": INTERACTING_RC, "src/a.ts": ELSE_RETURN });

  return { read: () => fs.readFileSync(path.join(root, "src/a.ts"), "utf8"), root };
}

it("lint --fix reruns oxlint over the files git lists until a pass rewrites none", { timeout: SLOW }, async () => {
  const { read, root } = interacting();
  const { stdout, stderr } = spies();
  process.chdir(root);
  expect(await lintMain(["--fix", "--max-warnings", "0", "src/a.ts"])).toBe(0);
  expect(read()).toBe(BOTH_FIXED);
  expect([...stdout(), ...stderr()]).toStrictEqual(["repo lint: no hits\n"]);
});

it("lint --all --fix prints the last pass as oxlint does, every hit it left", { timeout: SLOW }, async () => {
  const root = consumer({
    [BASELINE_PATH]: '{ "src/a.ts": { "typescript(no-non-null-assertion)": 1 } }\n',
    "src/a.ts": nonNull(1),
  });

  const { stdout } = spies();
  process.chdir(root);
  // oxlint's last pass writes through this process, so its text reaches the spy.
  expect(await lintMain(["--all", "--fix", "src/a.ts"])).toBe(1);
  expect(stdout().join("")).toContain("no-non-null-assertion");
});

it("lint --fix runs a single pass where git lists no files", { timeout: SLOW }, async () => {
  const { read, root } = interacting();
  const dotGit = path.join(root, ".git");
  spies();
  removeTree(dotGit);
  fs.writeFileSync(dotGit, "gitdir: missing\n");
  process.chdir(root);
  await lintMain(["--fix", "src/a.ts"]);
  expect(read()).toBe(ONE_PASS);
});

const AUGMENT = [
  'import type { Mock } from "vitest";',
  "",
  'declare module "vitest/browser" {',
  "  interface BrowserCommands {",
  "    serverRender: Mock;",
  "  }",
  "}",
  "",
].join("\n");

const CALLED_TEST = [
  'import { expect, it, vi } from "vitest";',
  "",
  'it("calls", () => {',
  "  const f = vi.fn();",
  "  f();",
  "  expect(f).toHaveBeenCalled();",
  "});",
  "",
].join("\n");

it(
  "lint --fix leaves an augmenting interface and a bare toHaveBeenCalled as written and names the latter",
  { timeout: SLOW },
  async () => {
    const root = consumer({ "src/a.test.ts": CALLED_TEST, "src/augment.ts": AUGMENT });
    const output = spies();
    process.chdir(root);
    await lintMain(["--fix", "src/augment.ts", "src/a.test.ts"]);
    expect(fs.readFileSync(path.join(root, "src/augment.ts"), "utf8")).toBe(AUGMENT);
    expect(fs.readFileSync(path.join(root, "src/a.test.ts"), "utf8")).toBe(CALLED_TEST);
    const printed = [...output.stdout(), ...output.stderr()].join("");
    expect(printed).toContain("repo(prefer-called-with)");
    expect(printed).not.toContain("consistent-type-definitions");
  },
);
