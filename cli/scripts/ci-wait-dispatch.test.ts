import { expect, it } from "vitest";

import { GH, GIT, LIST, SHA, bad, ok, run, view, world } from "./__fixtures__/ci-wait-world.ts";
import { DISPATCH_GRACE_MS, MS_PER_SECOND } from "./ci-wait.constants.ts";

/** `repo ci wait <branch>` on a branch ci runs on only by dispatch: no PR, not the default branch. */
const NONE = { ...GH, [`${LIST} ${SHA}`]: ok("[]") };
const FEAT = { ...GIT, "rev-parse --verify --quiet refs/remotes/origin/feat/x": ok(`${SHA}\n`) };
const GRACE = `${DISPATCH_GRACE_MS / MS_PER_SECOND}s`;
const LOOKING = `no ci run for b3f5e8a yet; looking for ${GRACE} in case one was dispatched…\n`;

const NOTHING =
  "nothing to wait on: ci runs on pushes to main, on pull requests and on gh workflow run, " +
  `and feat/x has no pull request and no run after ${GRACE}\n`;

it("no run, no open PR and not the default branch looks for a dispatched run, then is nothing to wait on", async () => {
  const got = await world(FEAT, { ...NONE, "pr list --head feat/x": ok("[]") }, "feat/x");
  expect(got).toMatchObject({ clock: DISPATCH_GRACE_MS, code: 3, err: "", out: `${LOOKING}${NOTHING}` });
  expect(got.record(SHA)).toMatchObject({ branch: "feat/x", failed: [], outcome: "nothing" });
});

it("a run dispatched just before the wait, listed on a later look, is waited on", async () => {
  const late = [ok("[]"), ok(JSON.stringify([run(9, "2026-11-09T10:00:00Z", "feat/x")]))];

  const gh = {
    ...GH,
    [`${LIST} ${SHA}`]: late,
    "pr list --head feat/x": ok("[]"),
    "run view 9 --json": view("success", []),
  };

  const got = await world(FEAT, gh, "feat/x");
  expect(got).toMatchObject({ code: 0, out: `${LOOKING}waiting for ci on b3f5e8a (run 9)…\npassed\n` });
  expect(got.record(SHA)).toMatchObject({ branch: "feat/x", outcome: "passed" });
});

it("an unreadable PR list or default branch is not proof of nothing", async () => {
  const unknown = { ...FEAT, "rev-parse --abbrev-ref origin/HEAD": bad("no origin") };
  const got = await world(unknown, { ...NONE, "pr list --head feat/x": bad("net") }, "feat/x");
  expect(got.code).toBe(4);
  const unset = await world(unknown, { ...NONE, "pr list --head feat/x": ok("[]") }, "feat/x");
  expect(unset.code).toBe(3);
  expect(unset.out).toContain("pushes to the default branch, on pull requests");
});

it("a dispatched run on a branch without a PR is waited on", async () => {
  const dispatched = run(9, "2026-11-09T10:00:00Z", "feat/x");

  const got = await world(
    FEAT,
    {
      ...GH,
      [`${LIST} ${SHA}`]: ok(JSON.stringify([dispatched])),
      "run view 9 --json": view("success", []),
    },
    "feat/x",
  );

  expect(got).toMatchObject({ code: 0, out: "waiting for ci on b3f5e8a (run 9)…\npassed\n" });
  expect(got.calls.some((call) => call.startsWith("gh pr list"))).toBe(false);
});
