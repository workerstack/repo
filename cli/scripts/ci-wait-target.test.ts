import { describe, expect, it } from "vitest";
import { waitFor, type Runner } from "./ci-wait.ts";

const SHA = "3f2a1c90123456789abcdef0123456789abcdef0";
const ok = (stdout = ""): { code: number; stdout: string; stderr: string } => ({ code: 0, stdout, stderr: "" });
const bad = { code: 1, stdout: "", stderr: "no" };
const RUN = { databaseId: 42, createdAt: "2026-11-09T10:00:00Z", headBranch: "main" };

/** Runs `waitFor` on a target while recording every git and gh call; git answers nothing useful. */
async function target(gh: Record<string, ReturnType<typeof ok>>, branch = "main") {
  const calls: string[] = [];
  const out: string[] = [];
  let clock = 0;
  const git: Runner = (args) => (calls.push(`git ${args.join(" ")}`), bad);
  const runGh: Runner = (args) => {
    const key = args.join(" ");
    calls.push(`gh ${key}`);
    const hit = Object.entries(gh).find(([prefix]) => key.startsWith(prefix));
    return hit?.[1] ?? bad;
  };
  const outcome = await waitFor({
    cwd: "/repo",
    stdout: (s) => out.push(s),
    stderr: () => undefined,
    now: () => clock,
    sleep: (ms) => ((clock += ms), Promise.resolve()),
    git,
    gh: runGh,
    target: { sha: SHA, branch },
  });
  return { outcome, calls, out: out.join("") };
}

const VIEW = ok(JSON.stringify({ conclusion: "success", jobs: [{ name: "test", conclusion: "success" }] }));

describe("waitFor with a target", () => {
  it("waits for the target commit without asking git for HEAD, the branch or the remotes", async () => {
    const got = await target({
      "auth status": ok(),
      "run list --commit": ok(JSON.stringify([RUN])),
      "run watch": ok(),
      "run view 42 --json": VIEW,
    });
    expect(got.outcome).toEqual({ kind: "passed" });
    expect(got.out).toBe("waiting for ci on 3f2a1c9 (run 42)…\npassed\n");
    expect(got.calls.filter((call) => call.startsWith("git"))).toEqual([]);
    expect(got.calls).toContain(
      `gh run list --commit ${SHA} --workflow ci.yml --json databaseId,status,conclusion,event,headBranch,createdAt`,
    );
  });

  it("keeps the gh login check", async () => {
    const got = await target({});
    expect(got.outcome).toEqual({
      kind: "error",
      line: "gh is not installed or not logged in; run `gh auth login`",
      detail: "gh is not installed or not logged in; run `gh auth login`",
    });
  });

  it("looks only at runs on the target's branch and gives up after two minutes", async () => {
    const got = await target({ "auth status": ok(), "run list --commit": ok(JSON.stringify([RUN])) }, "trunk");
    expect(got.outcome).toMatchObject({ kind: "error", detail: "no ci run after 120s" });
  });
});
