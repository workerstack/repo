import { afterEach, describe, expect, it, vi } from "vitest";

import { BIN, type Bin, exitWhenFlushed, main } from "./bin.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

/** A bin whose registry answers `code`, whose `cli/main.ts` runs `start`, and whose exit is recorded. */
function bin(code: number | null, start: () => Promise<void> = async () => {}) {
  return {
    dispatch: vi.fn<Bin["dispatch"]>(() => Promise.resolve(code)),
    exit: vi.fn<Bin["exit"]>(),
    load: vi.fn(() => Promise.resolve({ start })),
  };
}

describe("main", () => {
  it("exits with the code of a registry command or hook, never loading cli/main.ts", async () => {
    const deps = bin(3);
    await main(["hook", "turn"], deps);
    expect(deps.dispatch).toHaveBeenCalledWith(["hook", "turn"]);
    expect([deps.load.mock.calls.length, deps.exit.mock.calls]).toStrictEqual([0, [[3]]]);
  });

  it("runs cli/main.ts when the registry names nothing, then exits with the code it set", async () => {
    const start = vi.fn(async () => {});
    const deps = bin(null, start);
    await main(["init"], deps);
    expect([start.mock.calls.length, deps.exit.mock.calls]).toStrictEqual([1, [[undefined]]]);
  });

  it.each([
    [new Error("no manifest"), "repo: no manifest\n"],
    ["a string", "repo: a string\n"],
  ])("prints a thrown %j as repo: <message> and exits 1", async (thrown, printed) => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const deps = bin(null, () => Promise.reject(thrown));
    await main(["init"], deps);
    expect([stderr.mock.calls, deps.exit.mock.calls]).toStrictEqual([[[printed]], [[1]]]);
  });
});

describe("exitWhenFlushed", () => {
  it("exits with the code only after every stream's end callback has run", async () => {
    const events: string[] = [];
    const callbacks: (() => void)[] = [];
    function stream(name: string) {
      return {
        end: (cb: () => void) => {
          events.push(`end ${name}`);
          callbacks.push(() => {
            events.push(`flushed ${name}`);
            cb();
          });
        },
      };
    }
    const exit = vi.fn<(code?: number) => void>((code) => {
      events.push(`exit ${code}`);
    });
    const done = exitWhenFlushed([stream("out"), stream("err")], exit, 2);
    await Promise.resolve();
    expect([events, exit.mock.calls.length]).toStrictEqual([["end out", "end err"], 0]);
    callbacks[0]?.();
    await Promise.resolve();
    expect(exit.mock.calls.length).toBe(0);
    callbacks[1]?.();
    await done;
    expect([events.slice(2), exit.mock.calls]).toStrictEqual([["flushed out", "flushed err", "exit 2"], [[2]]]);
  });
});

describe("BIN", () => {
  it("is what main runs by default: the registry's code goes to the process's exit", async () => {
    const end = vi.spyOn(process.stdout, "end").mockImplementation(((cb: () => void) => {
      cb();
      return process.stdout;
    }) /* a spy standing in for a stream's end, which returns the stream */ as never);
    vi.spyOn(process.stderr, "end").mockImplementation(((cb: () => void) => {
      cb();
      return process.stderr;
    }) /* a spy standing in for a stream's end, which returns the stream */ as never);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined /* a spy, so the run goes on */ as never);
    await main(["hook"]);
    expect([stderr.mock.calls.length, end.mock.calls.length, exit.mock.calls]).toStrictEqual([1, 1, [[1]]]);
  });

  it("loads cli/main.ts lazily, its start among its exports", async () => {
    expect(typeof (await BIN.load()).start).toBe("function");
  });
});
