import { expect, it } from "vitest";

import { readCustom, rssFloorOf, spawnBun, usageMetrics } from "./measure.ts";

const MB = 1024 ** 2;

// Bun 1.4.4 reports `maxRSS` in bytes on every platform (it scales Linux's kilobytes itself; macOS's ru_maxrss and
// Windows' PeakWorkingSetSize are bytes) and `cpuTime` as bigint microseconds, so one conversion serves every OS.
it("turns maxRSS bytes into MB and user + system µs into ms", () => {
  const usage = { cpuTime: { system: 500n, total: 2000n, user: 1500n }, maxRSS: 48 * MB };
  expect(usageMetrics(usage)).toStrictEqual({ cpu: 2, rss: 48 });
});

it("keeps fractions of a MB and of a ms", () => {
  const usage = { cpuTime: { system: 0n, total: 250n, user: 250n }, maxRSS: 1.5 * MB };
  expect(usageMetrics(usage)).toStrictEqual({ cpu: 0.25, rss: 1.5 });
});

it("runs a real command and gives its exit, output and a non-zero peak RSS in bytes", () => {
  const script = "console.log('bench: {\"ops\": 1}'); console.error('warn'); process.exit(3)";
  const run = spawnBun(["bun", "-e", script], ".");
  expect(run).toMatchObject({ code: 3, stderr: "warn\n", stdout: 'bench: {"ops": 1}\n' });
  // A bun process holds megabytes, so a kilobyte count would read under 1 MB.
  expect(usageMetrics(run.usage).rss).toBeGreaterThan(1);
});

it("gives a command that cannot start a failed run with the reason", () => {
  const run = spawnBun(["no-such-command-for-bench"], ".");
  expect(run.code).toBe(1);
  expect(run.stderr).not.toBe("");
  expect(usageMetrics(run.usage)).toStrictEqual({ cpu: 0, rss: 0 });
});

it("reads the named metrics from the last stdout line's `bench:` JSON", () => {
  expect(readCustom('warming up\nbench: {"ops": 9120, "extra": 1}\n', ["ops"])).toStrictEqual({
    ok: true,
    values: { ops: 9120 },
  });
});

it("takes the last `bench:` line when several print, and a CRLF ending", () => {
  expect(readCustom('bench: {"ops": 1}\r\nbench: {"ops": 2}\r\n', ["ops"])).toStrictEqual({
    ok: true,
    values: { ops: 2 },
  });
});

it("needs nothing from stdout when the spec has no custom metric", () => {
  expect(readCustom("whatever\n", [])).toStrictEqual({ ok: true, values: {} });
});

it.each([
  ["no output", ""],
  ["a `bench:` line that is not the last", 'bench: {"ops": 1}\ndone\n'],
  ["JSON without the metric", 'bench: {"other": 1}\n'],
  ["a metric that is not a number", 'bench: {"ops": "fast"}\n'],
  ["a null metric", 'bench: {"ops": null}\n'],
  ["a JSON null", "bench: null\n"],
  ["JSON that does not parse", "bench: {ops: 1}\n"],
  ["a JSON value that is not an object", "bench: [1]\n"],
])("names the first missing metric for %s", (_, stdout) => {
  expect(readCustom(stdout, ["ops", "errors"])).toStrictEqual({ missing: "ops", ok: false });
});

it("names a later metric when only it is missing", () => {
  expect(readCustom('bench: {"ops": 1}\n', ["ops", "errors"])).toStrictEqual({ missing: "errors", ok: false });
});

// On Linux a spawned child's maxRSS starts at this process's own peak (the kernel carries the hiwater mark across
// exec), so the runner's VmHWM is the floor every rss sample sits on; macOS and Windows count per process.
it("reads the runner's peak RSS from VmHWM on linux, in bytes", () => {
  const status = "Name:\tbun\nVmPeak:\t  900000 kB\nVmHWM:\t   51200 kB\nVmRSS:\t   40000 kB\n";
  expect(rssFloorOf("linux", () => status)).toBe(50 * MB);
});

it("gives no floor off linux or when the status has no VmHWM line", () => {
  expect(rssFloorOf("darwin", () => "VmHWM:\t 51200 kB\n")).toBeNull();
  expect(rssFloorOf("win32", () => "VmHWM:\t 51200 kB\n")).toBeNull();
  expect(rssFloorOf("linux", () => "Name:\tbun\n")).toBeNull();
});
