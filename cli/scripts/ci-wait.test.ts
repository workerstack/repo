import { expect, it } from "vitest";
import { waitMain, type Runner } from "./ci-wait.ts";

const SHA = "b3f5e8a0123456789abcdef0123456789abcdef0";
const ok = (stdout = ""): { code: number; stdout: string; stderr: string } => ({ code: 0, stdout, stderr: "" });
const bad = (stderr = ""): { code: number; stdout: string; stderr: string } => ({ code: 1, stdout: "", stderr });
const run = (databaseId: number, createdAt: string, headBranch = "main") => ({ databaseId, createdAt, headBranch });
const job = (name: string, conclusion: string) => ({ name, conclusion });

type World = Record<string, ReturnType<typeof ok> | ReturnType<typeof ok>[]>;
const GIT: World = {
  "rev-parse HEAD": ok(`${SHA}\n`),
  [`branch -r --contains ${SHA}`]: ok("  origin/main\n"),
  "rev-parse --abbrev-ref HEAD": ok("main\n"),
};
const LIST = "run list --commit";
const BRANCH_LIST = "run list --branch main";

/** A runner that answers by the args joined; an array answers one call after another and repeats its last. */
function answerer(name: string, table: World, calls: string[]): Runner {
  return (args) => {
    const key = args.join(" ");
    calls.push(`${name} ${key}`);
    const value = Object.entries(table).find(([prefix]) => key === prefix || key.startsWith(`${prefix} `))?.[1];
    if (Array.isArray(value)) return value.length > 1 ? (value.shift() ?? bad()) : (value[0] ?? bad());
    return value ?? bad(`no answer for ${key}`);
  };
}

async function world(git: World, gh: World) {
  const calls: string[] = [];
  let clock = 0;
  const out: string[] = [];
  const err: string[] = [];
  const code = await waitMain({
    cwd: "/repo",
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    now: () => clock,
    sleep: (ms) => {
      clock += ms;
      return Promise.resolve();
    },
    git: answerer("git", git, calls),
    gh: answerer("gh", gh, calls),
  });
  return { code, out: out.join(""), err: err.join(""), calls, clock };
}

const GH: World = {
  "auth status": ok(),
  [`${LIST} ${SHA}`]: ok(JSON.stringify([run(123, "2026-11-09T10:00:00Z")])),
  "run watch 123": ok("watching\n"),
};
const view = (conclusion: string, jobs: ReturnType<typeof job>[]) => ok(JSON.stringify({ conclusion, jobs }));

it("a green run prints the waiting line and passed, exit 0", async () => {
  const got = await world(GIT, { ...GH, "run view 123 --json": view("success", [job("test", "success")]) });
  expect(got).toMatchObject({ code: 0, out: "waiting for ci on b3f5e8a (run 123)…\npassed\n", err: "" });
  expect(got.calls).toContain("gh run watch 123 --exit-status");
  expect(got.calls).toContain(
    `gh run list --commit ${SHA} --workflow ci.yml --json databaseId,status,conclusion,event,headBranch,createdAt`,
  );
  expect(got.calls).toContain("gh run view 123 --json conclusion,jobs");
});

it("a cancelled run with a newer ci run on the branch is superseded, exit 2", async () => {
  const got = await world(GIT, {
    ...GH,
    "run view 123 --json": view("cancelled", [job("test", "cancelled")]),
    [BRANCH_LIST]: ok(
      JSON.stringify([
        { databaseId: 123, createdAt: "2026-11-09T10:00:00Z" },
        { databaseId: 125, createdAt: "2026-11-09T10:05:00Z" },
        { databaseId: 124, createdAt: "2026-11-09T10:02:00Z" },
      ]),
    ),
  });
  expect(got).toMatchObject({ code: 2, out: "waiting for ci on b3f5e8a (run 123)…\nsuperseded by run 125 on main\n" });
  expect(got.calls).toContain(`gh ${BRANCH_LIST} --workflow ci.yml --json databaseId,createdAt`);
});

it("a manual cancel, with no newer run, is a failure with the logs", async () => {
  const got = await world(GIT, {
    ...GH,
    "run view 123 --json": view("cancelled", [job("test (ubuntu-latest)", "cancelled"), job("lint", "success")]),
    [BRANCH_LIST]: ok(JSON.stringify([{ databaseId: 123, createdAt: "2026-11-09T10:00:00Z" }])),
    "run view 123 --log-failed": ok("step log\n"),
  });
  expect(got).toMatchObject({
    code: 1,
    out: "waiting for ci on b3f5e8a (run 123)…\nfailed: test (ubuntu-latest); logs below\nstep log\n",
  });
});

it("an unreadable list of branch runs is no newer run", async () => {
  const got = await world(GIT, {
    ...GH,
    "run view 123 --json": view("cancelled", []),
    [BRANCH_LIST]: ok("not json"),
    "run view 123 --log-failed": ok("log\n"),
  });
  expect(got.code).toBe(1);
  expect(got.out).toContain("failed: ci cancelled; logs below\nlog\n");
});

it("a timeout and a failure list the failed jobs and show the logs, or say they expired", async () => {
  const jobs = [
    job("test (windows-latest)", "failure"),
    job("skips", "timed_out"),
    job("commits", "skipped"),
    job("ok", "success"),
  ];
  const failed = await world(GIT, {
    ...GH,
    "run view 123 --json": view("failure", jobs),
    "run view 123 --log-failed": ok("boom\n"),
  });
  expect(failed).toMatchObject({
    code: 1,
    out: "waiting for ci on b3f5e8a (run 123)…\nfailed: test (windows-latest), skips; logs below\nboom\n",
  });
  const expired = await world(GIT, {
    ...GH,
    "run view 123 --json": view("timed_out", jobs),
    "run view 123 --log-failed": bad("HTTP 410"),
  });
  expect(expired).toMatchObject({ code: 1 });
  expect(expired.out).toMatch(/failed: test \(windows-latest\), skips; logs below\nlogs expired\n$/);
});

it("a run whose result cannot be read is failed without a name", async () => {
  const got = await world(GIT, { ...GH, "run view 123 --json": bad("network"), "run view 123 --log-failed": bad() });
  expect(got.code).toBe(1);
  expect(got.out).toContain("failed: ci run has no result; logs below\nlogs expired\n");
});

it("of several runs it picks the newest on the current branch", async () => {
  const runs = [
    run(1, "2026-11-09T09:00:00Z"),
    run(7, "2026-11-09T11:00:00Z", "other"),
    run(5, "2026-11-09T10:30:00Z"),
    run(3, "2026-11-09T10:00:00Z"),
  ];
  const got = await world(GIT, {
    ...GH,
    [`${LIST} ${SHA}`]: ok(JSON.stringify(runs)),
    "run watch 5": ok(),
    "run view 5 --json": view("success", []),
  });
  expect(got).toMatchObject({ code: 0, out: "waiting for ci on b3f5e8a (run 5)…\npassed\n" });
});

it("it polls every 10 seconds until the run appears", async () => {
  const got = await world(GIT, {
    ...GH,
    [`${LIST} ${SHA}`]: [ok("[]"), ok("garbage"), ok("{}"), ok(JSON.stringify([run(123, "2026-11-09T10:00:00Z")]))],
    "run view 123 --json": view("success", []),
  });
  expect(got).toMatchObject({ code: 0, clock: 30_000 });
});

it("no run in 120 seconds is named and fails", async () => {
  const got = await world(GIT, { ...GH, [`${LIST} ${SHA}`]: ok("[]") });
  expect(got).toMatchObject({
    code: 1,
    out: "",
    err: "repo ci wait: no ci run for b3f5e8a after 120s; check the workflow ran\n",
    clock: 120_000,
  });
});

it("a HEAD on no remote branch is unpushed, before gh is asked anything", async () => {
  const got = await world({ ...GIT, [`branch -r --contains ${SHA}`]: ok("\n") }, {});
  expect(got).toMatchObject({
    code: 1,
    out: "",
    err: "repo ci wait: b3f5e8a is not on any remote branch; push it first\n",
  });
  expect(got.calls.some((call) => call.startsWith("gh "))).toBe(false);
});

it("gh missing or logged out is named", async () => {
  const got = await world(GIT, { "auth status": bad("not logged in") });
  expect(got).toMatchObject({
    code: 1,
    err: "repo ci wait: gh is not installed or not logged in; run `gh auth login`\n",
  });
});

it("outside a git checkout it says so", async () => {
  const got = await world({ "rev-parse HEAD": bad("fatal: not a git repository") }, {});
  expect(got).toMatchObject({
    code: 1,
    err: "repo ci wait: cannot read HEAD (fatal: not a git repository); run it inside a git checkout\n",
  });
});
