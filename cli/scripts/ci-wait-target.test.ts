import { describe, expect, it } from "vitest";

import { DISPATCH_GRACE_MS, MS_PER_SECOND } from "./ci-wait.constants.ts";
import { waitFor } from "./ci-wait.ts";
import type { Captured } from "./lint.ts";

const SHA = "3f2a1c90123456789abcdef0123456789abcdef0";

function ok(stdout = "") {
  return { code: 0, stderr: "", stdout };
}

const bad = { code: 1, stderr: "no", stdout: "" };
const RUN = { createdAt: "2026-11-09T10:00:00Z", databaseId: 42, headBranch: "main" };

/** Runs `waitFor` on a target while recording every git and gh call; git answers nothing useful. */
async function target(gh: Record<string, ReturnType<typeof ok>>, branch = "main") {
  const calls: string[] = [];
  const out: string[] = [];
  let clock = 0;

  function git(args: string[]): Captured {
    calls.push(`git ${args.join(" ")}`);

    return bad;
  }

  function runGh(args: string[]): Captured {
    const key = args.join(" ");
    calls.push(`gh ${key}`);
    const hit = Object.entries(gh).find(([prefix]) => key.startsWith(prefix));

    return hit?.[1] ?? bad;
  }

  const outcome = await waitFor({
    cwd: "/repo",
    gh: runGh,
    git,
    now: () => clock,
    sleep: (ms) => ((clock += ms), Promise.resolve()),
    stderr: () => {},
    stdout: (s) => out.push(s),
    target: { branch, sha: SHA },
  });

  return { calls, out: out.join(""), outcome };
}

const VIEW = ok(
  JSON.stringify({ conclusion: "success", jobs: [{ conclusion: "success", name: "test" }], status: "completed" }),
);

describe("waitFor with a target", () => {
  it("waits for the target commit without asking git for HEAD, the branch or the remotes", async () => {
    const got = await target({
      "auth status": ok(),
      "run list --commit": ok(JSON.stringify([RUN])),
      "run view 42 --json": VIEW,
      "run watch": ok(),
    });

    expect(got.outcome).toStrictEqual({ kind: "passed" });
    expect(got.out).toBe("waiting for ci on 3f2a1c9 (run 42)…\npassed\n");
    expect(got.calls.filter((call) => call.startsWith("git"))).toStrictEqual([]);
    expect(got.calls).toContain(
      `gh run list --commit ${SHA} --workflow ci.yml --json databaseId,status,conclusion,event,headBranch,createdAt`,
    );
  });

  it("keeps the gh login check", async () => {
    const got = await target({});
    expect(got.outcome).toStrictEqual({
      detail: "gh is not installed or not logged in; run `gh auth login`",
      kind: "error",
      line: "gh is not installed or not logged in; run `gh auth login`",
    });
  });

  it("looks only at runs on the target's branch and gives up after two minutes", async () => {
    const got = await target({ "auth status": ok(), "run list --commit": ok(JSON.stringify([RUN])) }, "trunk");
    expect(got.outcome).toMatchObject({ detail: "no ci run after 120s", kind: "error" });
  });
});

describe("waitFor on a branch ci does not run on", () => {
  it("is nothing, with the line that says why", async () => {
    const gh = { "auth status": ok(), "pr list": ok("[]"), "run list --commit": ok("[]") };
    const got = await target(gh, "feat/x");
    expect(got.outcome).toStrictEqual({
      kind: "nothing",
      line:
        "nothing to wait on: ci runs on pushes to the default branch, on pull requests and on gh workflow run, " +
        `and feat/x has no pull request and no run after ${DISPATCH_GRACE_MS / MS_PER_SECOND}s`,
    });
  });
});
