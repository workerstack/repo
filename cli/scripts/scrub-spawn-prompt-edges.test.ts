import { afterEach, describe, expect, it, vi } from "vitest";

import { stubProcessStdio } from "./__fixtures__/stub-process-stdio.ts";
import type { HookIo } from "./hook-io.ts";
import { main, processHookPayload, rewriteSpawnToolInput, spawnCapReason } from "./scrub-spawn-prompt.ts";

function fakeIo(payload: string, write: (text: string) => void): HookIo {
  let wasSent = false;

  return {
    readChunk: () => {
      if (wasSent) return null;
      wasSent = true;

      return Buffer.from(payload);
    },
    write,
  };
}

describe("rewriteSpawnToolInput shapes", () => {
  it("leaves a missing tool input alone", () => {
    expect(rewriteSpawnToolInput(undefined)).toBeNull();
  });

  it("leaves a record whose prompt is not a string alone", () => {
    expect(rewriteSpawnToolInput({ description: "x", prompt: 3 })).toBeNull();
    expect(rewriteSpawnToolInput({ description: "x" })).toBeNull();
  });
});

describe("processHookPayload shapes", () => {
  it.each([null, undefined, [], "text"] as const)("answers nothing for %j", (data) => {
    expect(processHookPayload(data /* payloads that are not hook objects */ as never)).toBeNull();
  });

  it("answers nothing when the tool input is missing or not a record", () => {
    expect(processHookPayload({})).toBeNull();
    expect(processHookPayload({ toolInput: "please go" /* a string where an object belongs */ as never })).toBeNull();
    expect(processHookPayload({ toolInput: { prompt: 3 } })).toBeNull();
  });
});

describe("spawnCapReason", () => {
  it("names the given root and falls back to the resolved one", () => {
    expect(spawnCapReason("/planted/root")).toContain("/planted/root/.repo/plans/");
    expect(spawnCapReason()).toContain("/.repo/plans/");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("main process stdio", () => {
  it("reads the process stdin and answers on stdout by default", () => {
    const written = stubProcessStdio({ toolInput: { prompt: "please go now" } });
    expect(main()).toBe(0);
    expect(written()).toContain('"prompt":"go now"');
  });
});

describe("main", () => {
  it("prints nothing when the prompt is already clean", () => {
    const out: string[] = [];
    expect(
      main(
        [],
        fakeIo(JSON.stringify({ toolInput: { prompt: "go now" } }), (t) => out.push(t)),
      ),
    ).toBe(0);
    expect(out).toStrictEqual([]);
  });

  it("prints the rewrite and exits 0", () => {
    const out: string[] = [];

    const code = main(
      [],
      fakeIo(JSON.stringify({ toolInput: { prompt: "please go now" } }), (t) => out.push(t)),
    );

    expect(code).toBe(0);
    expect(JSON.parse(out.join(""))).toMatchObject({ hookSpecificOutput: { updatedInput: { prompt: "go now" } } });
  });

  it("fails open with exit 0 when writing the reply throws", () => {
    const io = fakeIo(JSON.stringify({ toolInput: { prompt: "please go now" } }), () => {
      throw new Error("pipe closed");
    });

    expect(main([], io)).toBe(0);
  });
});

describe("over-cap prompt", () => {
  it("denies a prompt the scrub leaves unchanged and over the cap", () => {
    const answer = processHookPayload({ toolInput: { prompt: "x".repeat(100001) }, workspaceRoot: "/planted/root" });
    expect(answer).toMatchObject({ decision: "block" });
    expect(answer?.reason).toContain("re-spawn");
  });
});
