import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import {
  GH,
  GIT,
  LIST,
  SHA,
  BRANCH_LIST,
  answerer,
  bad,
  job,
  ok,
  run,
  view,
  world,
} from "./__fixtures__/ci-wait-world.ts";
import type { RecordFs } from "./ci-wait-record.ts";
import { waitMain } from "./ci-wait.ts";

const NONE = { ...GH, [`${LIST} ${SHA}`]: ok("[]") };

function tip(branch: string) {
  return `rev-parse --verify --quiet refs/remotes/origin/${branch}`;
}

const FEAT = { ...GIT, [tip("feat/x")]: ok(`${SHA}\n`) };
const NOTHING = "nothing to wait on: ci runs on pushes to main and on pull requests, and feat/x has neither\n";

it("no run, no open PR and not the default branch is nothing to wait on, decided on the first look", async () => {
  const got = await world(FEAT, { ...NONE, "pr list --head feat/x": ok("[]") }, "feat/x");
  expect(got).toMatchObject({ clock: 0, code: 3, err: "", out: NOTHING });
  expect(got.record(SHA)).toMatchObject({ branch: "feat/x", failed: [], outcome: "nothing" });
});

it("a branch with an open PR keeps looking for its run, then errors", async () => {
  const got = await world(FEAT, { ...NONE, "pr list --head feat/x": ok('[{"number":3}]') }, "feat/x");
  expect(got).toMatchObject({ clock: 120_000, code: 4 });
  expect(got.err).toContain("no ci run for b3f5e8a after 120s");
});

it("the default branch keeps looking for its run, then errors", async () => {
  const got = await world(GIT, NONE);
  expect(got).toMatchObject({ clock: 120_000, code: 4 });
  expect(got.calls.some((call) => call.startsWith("gh pr list"))).toBe(false);
});

it("an unreadable PR list or default branch is not proof of nothing", async () => {
  const unknown = { ...FEAT, "rev-parse --abbrev-ref origin/HEAD": bad("no origin") };
  const got = await world(unknown, { ...NONE, "pr list --head feat/x": bad("net") }, "feat/x");
  expect(got.code).toBe(4);
  const unset = await world(unknown, { ...NONE, "pr list --head feat/x": ok("[]") }, "feat/x");
  expect(unset.code).toBe(3);
  expect(unset.out).toContain("pushes to the default branch");
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

it("<branch> waits on that branch's tip without asking for HEAD or its name", async () => {
  const got = await world(
    FEAT,
    {
      ...GH,
      [`${LIST} ${SHA}`]: ok(JSON.stringify([run(9, "2026-11-09T10:00:00Z", "feat/x")])),
      "run view 9 --json": view("success", []),
    },
    "feat/x",
  );

  expect(got.code).toBe(0);
  expect(got.calls).toContain(`git ${tip("feat/x")}`);
  expect(got.calls.some((call) => call.startsWith("git branch -r"))).toBe(false);
  expect(got.calls).not.toContain("git rev-parse HEAD");
  expect(got.calls).not.toContain("git rev-parse --abbrev-ref HEAD");
  expect(got.record(SHA)).toMatchObject({ branch: "feat/x", outcome: "passed" });
});

it("a branch that is not on origin is named, exits 4 without a record, and is not fetched", async () => {
  const got = await world(GIT, {}, "nope");
  expect(got).toMatchObject({ code: 4, err: "repo ci wait: nope is not on origin; push it first\n" });
  expect(got.files.size).toBe(0);
  expect(got.calls.some((call) => call.startsWith("git fetch"))).toBe(false);
});

it("a branch ahead of origin is waited on at origin's sha, not the local one", async () => {
  const origin = "c0ffee00123456789abcdef0123456789abcdef0";

  const got = await world(
    { ...GIT, [tip("feat/x")]: ok(`${origin}\n`), "rev-parse feat/x": ok(`${SHA}\n`) },
    {
      ...GH,
      [`${LIST} ${origin}`]: ok(JSON.stringify([run(9, "2026-11-09T10:00:00Z", "feat/x")])),
      "run view 9 --json": view("success", []),
    },
    "feat/x",
  );

  expect(got).toMatchObject({ code: 0, out: "waiting for ci on c0ffee0 (run 9)…\npassed\n" });
  expect(got.calls).not.toContain("git rev-parse feat/x");
  expect(got.record(origin)).toMatchObject({ branch: "feat/x", outcome: "passed" });
  expect(got.record(SHA)).toBeUndefined();
});

it("a run still going after 45 minutes errors with how to look at it, and is recorded", async () => {
  const got = await world(GIT, { ...GH, "run view 123 --json": view("", [], "in_progress") });
  expect(got).toMatchObject({
    clock: 45 * 60_000,
    code: 4,
    err: "repo ci wait: run 123 still running after 45m; check it with `gh run view 123`\n",
    out: "waiting for ci on b3f5e8a (run 123)…\n",
  });
  expect(got.record(SHA)).toMatchObject({ failed: [], outcome: "error" });
});

it("a run view that cannot be read is retried until the bound, not called a failure", async () => {
  const got = await world(GIT, { ...GH, "run view 123 --json": bad("network") });
  expect(got).toMatchObject({ clock: 45 * 60_000, code: 4 });
});

it("the bound counts the time spent finding the run", async () => {
  const late = [...Array.from({ length: 11 }, () => ok("")), ok(JSON.stringify([run(123, "2026-11-09T10:00:00Z")]))];
  const got = await world(GIT, { ...GH, [`${LIST} ${SHA}`]: late, "run view 123 --json": view("", [], "queued") });
  expect(got.clock).toBe(45 * 60_000);
});

it("each outcome is recorded by full sha with its branch, failed jobs and time", async () => {
  const jobs = [job("test (windows-latest)", "failure"), job("lint", "success")];

  const got = await world(GIT, {
    ...GH,
    "run view 123 --json": view("failure", jobs),
    "run view 123 --log-failed": ok("x\n"),
  });

  expect(got.record(SHA)).toStrictEqual({
    at: "1970-01-01T00:00:00.000Z",
    branch: "main",
    failed: ["test (windows-latest)"],
    outcome: "failed",
  });

  const superseded = await world(GIT, {
    ...GH,
    [BRANCH_LIST]: ok(JSON.stringify([{ createdAt: "2026-11-09T10:05:00Z", databaseId: 124 }])),
    "run view 123 --json": view("cancelled", []),
  });

  expect(superseded.record(SHA)).toMatchObject({ outcome: "superseded" });
});

it("a record that cannot be written is said on stderr and does not change the exit code", async () => {
  const code = await waitMain({
    cwd: "/repo",
    fs: {
      mkdirSync: () => {
        throw new Error("read-only");
      },
      rmSync: () => {},
    } as unknown /* only the methods a record calls are given */ as RecordFs,
    gh: answerer("gh", { ...GH, "run view 123 --json": view("success", []) }, []),
    git: answerer("git", GIT, []),
    now: () => 0,
    sleep: () => Promise.resolve(),
    stderr: (s) => errs.push(s),
    stdout: () => {},
  });

  expect(code).toBe(0);
  expect(errs.join("")).toBe(`repo ci wait: cannot record the outcome for ${SHA}\n`);
});

const errs: string[] = [];

it("with no runners injected it uses the real git, gh, clock and sleep, and outside a checkout says so", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-wait-real-"));
  const err: string[] = [];

  try {
    const code = await waitMain({ cwd: dir, stderr: (s) => err.push(s), stdout: () => {} });
    expect(code).toBe(4);
    expect(err.join("")).toMatch(/^repo ci wait: cannot read HEAD \(.*\); run it inside a git checkout\n$/s);
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

it("a HEAD that git answers with nothing is unreadable too", async () => {
  const got = await world({ "rev-parse HEAD": ok("\n") }, {});
  expect(got).toMatchObject({ code: 4, err: "repo ci wait: cannot read HEAD (); run it inside a git checkout\n" });
});

it("a branch on origin still needs gh logged in", async () => {
  const got = await world(FEAT, { "auth status": bad("no") }, "feat/x");
  expect(got).toMatchObject({
    code: 4,
    err: "repo ci wait: gh is not installed or not logged in; run `gh auth login`\n",
  });
});
