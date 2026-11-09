import { expect, it } from "vitest";
import { inheritRunner, realSleep, spawnRunner } from "./ci-wait-run.ts";

it("a runner captures a tool's output and code", () => {
  const got = spawnRunner("git")(["--version"], process.cwd());
  expect(got).toMatchObject({ code: 0, stderr: "" });
  expect(got.stdout).toMatch(/^git version/);
  expect(spawnRunner("git")(["no-such-command"], process.cwd()).code).not.toBe(0);
});

it("a tool that cannot start is a failed run with the reason", () => {
  const got = spawnRunner("workerstack-no-such-tool")([], process.cwd());
  expect(got.code).toBe(1);
  expect(got.stderr).toContain("workerstack-no-such-tool");
});

it("an inheriting runner reports a tool's exit code and captures nothing", () => {
  const run = inheritRunner(process.execPath);
  expect(run(["-e", "process.exit(0)"], process.cwd())).toEqual({ code: 0, stdout: "", stderr: "" });
  expect(run(["-e", "process.exit(3)"], process.cwd())).toEqual({ code: 3, stdout: "", stderr: "" });
});

it("an inheriting runner that cannot start is a failed run with the reason", () => {
  const got = inheritRunner("workerstack-no-such-tool")([], process.cwd());
  expect(got.code).toBe(1);
  expect(got.stderr).toContain("workerstack-no-such-tool");
});

it("an inheriting runner for a tool killed by a signal is a failed run", () => {
  const run = inheritRunner(process.execPath);
  expect(run(["-e", 'process.kill(process.pid, "SIGKILL")'], process.cwd()).code).toBe(1);
});

it("the real sleep waits", async () => {
  const started = Date.now();
  await realSleep(5);
  expect(Date.now() - started).toBeGreaterThanOrEqual(4);
});

it("a tool killed by a signal is a failed run", () => {
  const got = spawnRunner(process.execPath)(["-e", 'process.kill(process.pid, "SIGKILL")'], process.cwd());
  expect(got.code).toBe(1);
});
