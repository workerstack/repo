import { afterEach, describe, expect, it, vi } from "vitest";
import { BIN, type Bin, main } from "./bin.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

/** A bin whose registry answers `code`, whose `cli/main.ts` runs `start`, and whose exit is recorded. */
function bin(code: number | null, start: () => Promise<void> = async () => {}) {
  return {
    dispatch: vi.fn<Bin["dispatch"]>(() => Promise.resolve(code)),
    load: vi.fn(() => Promise.resolve({ start })),
    exit: vi.fn<Bin["exit"]>(),
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

describe("BIN", () => {
  it("is what main runs by default: the registry's code goes to the process's exit", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined /* a spy, so the run goes on */ as never);
    await main(["hook"]);
    expect([stderr.mock.calls.length, exit.mock.calls]).toStrictEqual([1, [[1]]]);
  });

  it("loads cli/main.ts lazily, its start among its exports", async () => {
    expect(typeof (await BIN.load()).start).toBe("function");
  });
});
