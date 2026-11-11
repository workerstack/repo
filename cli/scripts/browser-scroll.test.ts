import { afterEach, expect, it } from "vitest";

import { cleanBrowser, exec, failure, live, methods, NO_SESSION, nth, tmp } from "./fixtures/browser-kit.ts";
import type { Calls } from "./fixtures/browser-kit.ts";

afterEach(cleanBrowser);

it("wait needs a session", async () => {
  expect((await exec(tmp("browser-wait-none-"), ["wait", "0"])).stderr).toBe(NO_SESSION);
});

it("wait sleeps the given ms, reads junk and negatives as 0, and defaults to 1000", async () => {
  const t = await live();
  expect((await exec(t.cwd, ["wait", "15"])).stdout).toBe("wait: 15\n");
  expect((await exec(t.cwd, ["wait", "abc"])).stdout).toBe("wait: 0\n");
  expect((await exec(t.cwd, ["wait", "-5"])).stdout).toBe("wait: 0\n");
  const t0 = Date.now();
  expect((await exec(t.cwd, ["wait"])).stdout).toBe("wait: 1000\n");
  expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
});

const scrolls = (calls: Calls) => calls.filter((c) => c.method === "Runtime.evaluate").map((c) => c.params.expression);

it("scroll needs a session", async () => {
  expect((await exec(tmp("browser-scroll-none-"), ["scroll"])).stderr).toBe(NO_SESSION);
});

it("scroll goes 600 down, -600 up, a number of pixels, and 600 for anything else", async () => {
  const args: (string | undefined)[] = [undefined, "down", "up", "250", "-40", "sideways"];
  const done = await Promise.all(
    args.map(async (arg) => {
      const t = await live();
      const r = await exec(t.cwd, arg === undefined ? ["scroll"] : ["scroll", arg]);
      return [r.stdout, scrolls(t.calls)];
    }),
  );
  expect(done).toStrictEqual([
    ["scroll: down\n", ["window.scrollBy(0, 600)"]],
    ["scroll: down\n", ["window.scrollBy(0, 600)"]],
    ["scroll: up\n", ["window.scrollBy(0, -600)"]],
    ["scroll: 250\n", ["window.scrollBy(0, 250)"]],
    ["scroll: -40\n", ["window.scrollBy(0, -40)"]],
    ["scroll: sideways\n", ["window.scrollBy(0, 600)"]],
  ]);
});

it("scroll brings a remembered ref into view", async () => {
  const t = await live();
  expect((await exec(t.cwd, ["scroll", "2"])).stdout).toBe("scroll: 2\n");
  expect(methods(t.calls)).toStrictEqual(["DOM.resolveNode", "Runtime.callFunctionOn"]);
  expect(nth(t.calls, 0).params).toStrictEqual({ backendNodeId: 11 });
  expect(nth(t.calls, 1).params).toMatchObject({ objectId: "oid-11" });
  expect(String(nth(t.calls, 1).params.functionDeclaration)).toContain("scrollIntoView");
});

it("scroll calls a ref stale when it no longer resolves, however the engine says so", async () => {
  const gone = await live({ lastRefs: { "1": { backendNodeId: 99 } } });
  expect((await exec(gone.cwd, ["scroll", "1"])).stderr).toBe("stale ref: 1\n");
  const noObject = await live({}, { replies: { "DOM.resolveNode": {} } });
  expect((await exec(noObject.cwd, ["scroll", "1"])).stderr).toBe("stale ref: 1\n");
  const missing = await live({}, { replies: { "Runtime.evaluate": "node is missing" } });
  expect((await exec(missing.cwd, ["scroll", "up"])).stderr).toBe("stale ref: up\n");
});

it("scroll reports another engine error as it is, with one trailing newline", async () => {
  const t = await live({}, { replies: { "Runtime.evaluate": "Error: boom" } });
  expect(await exec(t.cwd, ["scroll"])).toStrictEqual(failure("boom\n"));
  const nl = await live({}, { replies: { "Runtime.evaluate": "two\nlines\n" } });
  expect(await exec(nl.cwd, ["scroll"])).toStrictEqual(failure("two\nlines\n"));
});
