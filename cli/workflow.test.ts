import { expect, it } from "vitest";

import { configDir, repo, useConfigKit } from "./__fixtures__/config-kit.ts";
import { DEFAULT_WORKFLOW, readWorkflow, rulesOf, WORKFLOWS } from "./workflow.ts";

useConfigKit();

it("defaults to worktree", () => {
  expect(DEFAULT_WORKFLOW).toBe("worktree");
});

it.each(WORKFLOWS)("reads workflow: %s", (workflow) => {
  expect(readWorkflow(repo(`export default { workflow: "${workflow}" };\n`, null))).toBe(workflow);
});

it("reads worktree when the repo has no repo.config.ts", () => {
  expect(readWorkflow(configDir())).toBe("worktree");
});

it("reads worktree when the config omits workflow", () => {
  expect(readWorkflow(repo('export default { packs: ["docs"] };\n', null))).toBe("worktree");
});

it("reads unreadable when the config throws as it loads", () => {
  expect(readWorkflow(repo('throw new Error("boom");\n', null))).toBe("unreadable");
});

it("reads unreadable for a workflow outside the three", () => {
  expect(readWorkflow(repo('export default { workflow: "trunk" };\n', null))).toBe("unreadable");
});

it.each(["export default 5;\n", "export default null;\n", "export default [];\n", "export const workflow = 1;\n"])(
  "reads unreadable for a default export that is not an object: %s",
  (text) => {
    expect(readWorkflow(repo(text, null))).toBe("unreadable");
  },
);

it.each([
  ["worktree", { mainCheckoutWrites: false, pushDefaultBranch: true }],
  ["pull-request", { mainCheckoutWrites: false, pushDefaultBranch: false }],
  ["main", { mainCheckoutWrites: true, pushDefaultBranch: true }],
  ["unreadable", { mainCheckoutWrites: false, pushDefaultBranch: false }],
] as const)("rulesOf(%s)", (read, rules) => {
  expect(rulesOf(read)).toStrictEqual(rules);
});
