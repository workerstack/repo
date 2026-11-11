import { expect, it } from "vitest";
import { z } from "zod";

import { finish, newestFirst, readJson, type PollIo } from "./ci-wait-poll.ts";

const RUN = { createdAt: "2026-11-10T10:00:00Z", databaseId: 5, headBranch: "main" };
const done = (conclusion: string) =>
  JSON.stringify({ conclusion, jobs: [{ conclusion, name: "test" }], status: "completed" });

/** A poll world where gh answers `views` one after another (the last repeats) and the clock moves with sleep. */
function io(views: string[], out: string[] = []): PollIo & { clock: () => number } {
  let clock = 0;
  let i = 0;
  return {
    clock: () => clock,
    cwd: "/r",
    gh: (args) => {
      if (args.includes("--log-failed")) return { code: 0, stderr: "", stdout: "log\n" };
      const body = views[Math.min(i++, views.length - 1)] ?? "";
      return { code: 0, stderr: "", stdout: body };
    },
    now: () => clock,
    sleep: (ms) => ((clock += ms), Promise.resolve()),
    stdout: (s) => out.push(s),
  };
}

it("looks every 10 seconds until the run completes, then reports it", async () => {
  const out: string[] = [];
  const world = io([JSON.stringify({ conclusion: "", jobs: [], status: "queued" }), done("success")], out);
  expect(await finish(world, RUN, 0)).toStrictEqual({ kind: "passed" });
  expect(world.clock()).toBe(10_000);
  expect(out.join("")).toBe("passed\n");
});

it("past 45 minutes it is an error naming the run and how to look at it", async () => {
  const world = io(["not json"]);
  expect(await finish(world, RUN, 0)).toStrictEqual({
    detail: "run 5 still running after 45m",
    kind: "error",
    line: "run 5 still running after 45m; check it with `gh run view 5`",
  });
  expect(world.clock()).toBe(2_700_000);
});

it("a failure lists the failed jobs", async () => {
  expect(await finish(io([done("failure")]), RUN, 0)).toStrictEqual({ jobs: ["test"], kind: "failed" });
});

it("newestFirst orders by creation time and readJson rejects a bad shape or a failed run", () => {
  expect(
    newestFirst([{ createdAt: "a" }, { createdAt: "c" }, { createdAt: "b" }]).map((r) => r.createdAt),
  ).toStrictEqual(["c", "b", "a"]);
  expect(readJson({ code: 0, stdout: "[1]" }, z.array(z.string()))).toBeNull();
  expect(readJson({ code: 1, stdout: "[]" }, z.array(z.string()))).toBeNull();
  expect(readJson({ code: 0, stdout: "[]" }, z.array(z.string()))).toStrictEqual([]);
});
