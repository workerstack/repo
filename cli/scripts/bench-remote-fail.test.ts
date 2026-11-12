import { expect, it } from "vitest";

import { useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { BENCH_YML, GH, MAC, listed, remote, view } from "./__fixtures__/bench-remote-world.ts";
import { REMOTE_GIT, RUN_URL, SHA, STARTUP, bad, bench, ok, rawOn } from "./__fixtures__/bench-world.ts";

useTempDirs();

function dispatches(calls: readonly string[]) {
  return calls.filter((call) => call.startsWith("gh workflow run"));
}

it("refuses a spec whose os names only this machine's label, exit 4", async () => {
  const got = await bench(["remote-only", "--remote"], {
    files: BENCH_YML,
    gh: GH,
    git: REMOTE_GIT,
    machine: { arch: "arm64", platform: "darwin" },
    specs: ["remote-only"],
  });

  expect(got).toMatchObject({
    code: 4,
    err: "repo bench: remote-only's os names no runner but this one; add one or run without --remote\n",
    out: "",
  });
  expect(dispatches(got.calls)).toStrictEqual([]);
});

it("checks bench.yml on origin/main when origin/HEAD is not set", async () => {
  const { "rev-parse --abbrev-ref origin/HEAD": _, ...git } = REMOTE_GIT;
  const got = await remote({ git });
  expect(got.code).toBe(0);
  expect(got.calls).toContain("git cat-file -e origin/main:.github/workflows/bench.yml");
});

it("stops before dispatching when a local candidate fails, exit 1", async () => {
  const spawn = { ...STARTUP, "bun -e 2": () => ({ code: 1, stderr: "boom\n" }) };
  const got = await remote({ spawn });
  expect(got).toMatchObject({ code: 1, err: "repo bench: node warmup 1 exited 1; stderr tail: boom\n", out: "" });
  expect(dispatches(got.calls)).toStrictEqual([]);
});

it("names gh's reason when the dispatch is refused, exit 1", async () => {
  const got = await remote({
    gh: { ...GH, "workflow run": bad("HTTP 422: Workflow does not have 'workflow_dispatch'\n") },
  });

  expect(got.code).toBe(1);
  expect(got.err).toBe(
    "repo bench: gh could not dispatch bench.yml: HTTP 422: Workflow does not have 'workflow_dispatch'\n",
  );
});

it("gives up when no new run shows up in 5 minutes, even when gh run list fails", async () => {
  const got = await remote({ gh: { ...GH, "run list": bad("HTTP 502") } });
  expect(got.code).toBe(1);
  expect(got.err).toBe("repo bench: no bench.yml run at 82c0e43 showed up in 5 min\n");
});

it("gives up on a run still going after 90 minutes and links it", async () => {
  const got = await remote({ gh: { ...GH, "run view 123": [view("in_progress", ""), bad("HTTP 502")] } });
  expect(got.code).toBe(1);
  expect(got.err).toBe(`repo bench: run 123 still running after 90 min; see ${RUN_URL}\n`);
});

it("names the conclusion when a failed run lists no failed job", async () => {
  const got = await remote({ gh: { ...GH, "run view 123": [view("completed", "cancelled")] } });
  expect(got.err).toBe(`repo bench: run 123 failed (cancelled); see ${RUN_URL}\n`);
});

it("names the OS whose raw result the run did not upload, exit 1", async () => {
  const got = await remote({ artifacts: { "macos-latest": rawOn(MAC), "windows-latest": { spec: "startup" } } });
  expect(got.code).toBe(1);
  expect(got.err).toBe(`repo bench: run 123 left no bench result for windows-latest; see ${RUN_URL}\n`);
});

it("prints the dispatched line before it waits", async () => {
  const got = await remote({ gh: { ...GH, "run view 123": [view("completed", "failure")] } });
  expect(got.out).toContain(
    `repo bench: dispatched bench.yml at 82c0e43 for macos-latest, windows-latest: ${RUN_URL}\n`,
  );
});

it("waits for its own run, past an earlier dispatch at the same sha", async () => {
  const earlier = listed(120, SHA, ["workflow_dispatch", 1]);
  const mine = listed(123, SHA, ["workflow_dispatch", 4]);
  const list = [ok(JSON.stringify([earlier])), ok(JSON.stringify([earlier])), ok(JSON.stringify([mine, earlier]))];
  const got = await remote({ gh: { ...GH, "run list": list } });
  expect(got.code).toBe(0);
  expect(
    got.calls.filter((call) => call.startsWith("gh run view")).every((call) => call.startsWith("gh run view 123 ")),
  ).toBe(true);
  expect(got.calls.filter((call) => call.startsWith("gh run list"))).toHaveLength(3);
});
