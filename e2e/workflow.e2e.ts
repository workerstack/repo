/**
 * Each `workflow` mode driven through the installed package in one consumer with a bare origin and a stub gh: the
 * real sync writes its AGENTS.md paragraph, the real Claude PreToolUse gate judges its calls, and the real
 * `bun repo worktree finish` lands or opens a pull request. The modes run in order, each committing its config first.
 */
import { beforeAll, describe } from "vitest";

import { expectClean } from "./hosts-kit";
import { PACKAGE_NAME } from "./registry";
import { Sandbox } from "./sandbox";
import { mainCase, pullRequestCase, worktreeCase } from "./workflow-cases";
import { makeOrigin } from "./workflow-kit";

describe("workflow modes", () => {
  let made: Sandbox | undefined;

  function get(): Sandbox {
    if (made === undefined) throw new Error("the workflow sandbox is made in beforeAll");

    return made;
  }

  beforeAll(async () => {
    const sb = new Sandbox("workflow");
    made = sb;
    await sb.scaffold();
    expectClean(sb, await sb.launch(PACKAGE_NAME, "init"));
    await sb.commit("chore: init");
    await makeOrigin(sb);
  });

  worktreeCase(get);
  pullRequestCase(get);
  mainCase(get);
});
