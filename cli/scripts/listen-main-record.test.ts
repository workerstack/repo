import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FFMPEG, readSession, run, tmp, type Handler, which, cleanupTmp } from "./__fixtures__/listen-env.ts";
import { NEED_FFMPEG } from "./listen.constants.ts";
import type { ChildLike } from "./listen.types.ts";

afterEach(cleanupTmp);

type DriveCtx = { on: Record<string, Handler>; signal: (name: "SIGINT" | "SIGTERM") => void };

type Drive = (ctx: DriveCtx) => void;

/** Runs `_record` with a fake ffmpeg, calls `drive`, and removes every signal listener main added. */
async function record(spec: { argv: string[]; stdin?: ChildLike["stdin"]; drive: Drive }) {
  const before = { SIGINT: process.listeners("SIGINT"), SIGTERM: process.listeners("SIGTERM") };

  function added(name: "SIGINT" | "SIGTERM") {
    return process.listeners(name).filter((l) => !before[name].includes(l));
  }

  function removeAdded(name: "SIGINT" | "SIGTERM"): void {
    for (const listener of added(name)) process.off(name, listener);
  }

  const on: Record<string, Handler> = {};
  const spawned: Array<{ bin: string; args: string[] }> = [];

  function spawnFn(bin: string, args: string[]): ChildLike {
    spawned.push({ args, bin });

    return { on: (ev: string, cb: Handler) => void (on[ev] = cb), stdin: spec.stdin ?? null };
  }

  try {
    const pending = run(spec.argv, { spawnFn });
    spec.drive({
      on,
      signal: (name) => {
        for (const listener of added(name)) listener(name);
      },
    });

    return { ...(await pending), spawned };
  } finally {
    for (const name of ["SIGINT", "SIGTERM"] as const) removeAdded(name);
  }
}

/** Sends SIGINT then SIGTERM, then lets ffmpeg exit 0. */
function bothSignalsThenExit({ on, signal }: DriveCtx): void {
  signal("SIGINT");
  signal("SIGTERM");
  on.exit?.(0);
}

/** Sends SIGINT, then lets ffmpeg exit 0. */
function sigintThenExit({ on, signal }: DriveCtx): void {
  signal("SIGINT");
  on.exit?.(0);
}

/** Fails the ffmpeg spawn. */
function spawnFails({ on }: DriveCtx): void {
  on.error?.(new Error("spawn ffmpeg ENOENT"));
}

/** A stdin write or end on a closed pipe. */
function brokenPipe(): never {
  throw new Error("EPIPE");
}

describe("_record arguments", () => {
  it("needs --out and ffmpeg", async () => {
    const noOut = await run(["_record"]);
    expect(noOut.errs).toStrictEqual(["_record needs --out"]);
    const r = await run(["_record", "--out", "/x.wav"], { whichFn: which({}) });
    expect(r.errs).toStrictEqual([NEED_FFMPEG]);
  });

  it("--seconds bounds the recording", async () => {
    const argv = ["_record", "--out", "/tmp/never-written.wav", "--seconds", "500"];
    const r = await record({ argv, drive: ({ on }) => on.exit?.(0) });
    const args = r.spawned[0]?.args ?? [];
    expect(args[args.indexOf("-t") + 1]).toBe("120");
  });
});

describe("_record session", () => {
  it("records until ffmpeg exits, leaving a session for stop", async () => {
    const out = path.join(tmp("listen-rec-o-"), "nested", "r.wav");
    const argv = ["_record", "--out", out, "--device", ":1"];
    const r = await record({ argv, drive: ({ on }) => on.exit?.(0) });
    expect(r.code).toBe(0);
    expect(r.spawned[0]?.bin).toBe(FFMPEG);
    expect(r.spawned[0]?.args).toContain(":1");
    expect(r.spawned[0]?.args).not.toContain("-t");
    expect(readSession(r.cwd)).toMatchObject({ pid: process.pid, wav: out });
    expect(fs.existsSync(path.dirname(out))).toBe(true);
  });
});

describe("_record signals", () => {
  const argv = ["_record", "--out", "/tmp/q.wav"];

  it("SIGINT and SIGTERM ask ffmpeg to quit by writing q to its stdin", async () => {
    const writes: string[] = [];
    let ended = 0;
    const stdin = { end: () => void (ended += 1), write: (c: string) => writes.push(c) };
    const r = await record({ argv, drive: bothSignalsThenExit, stdin });
    expect(r.code).toBe(0);
    expect(writes).toStrictEqual(["q\n", "q\n"]);
    expect(ended).toBe(2);
  });

  it("a signal with no stdin to write to still lets the recorder finish", async () => {
    const r = await record({
      argv,
      drive: ({ on, signal }) => {
        signal("SIGTERM");
        on.exit?.(0);
      },
    });

    expect(r.code).toBe(0);
  });
});

describe("_record broken stdin", () => {
  const argv = ["_record", "--out", "/tmp/q.wav"];

  it("a broken stdin does not stop the shutdown", async () => {
    const stdin = { end: brokenPipe, write: brokenPipe };
    const r = await record({ argv, drive: sigintThenExit, stdin });
    expect(r.code).toBe(0);
  });
});

describe("_record exit", () => {
  const argv = ["_record", "--out", "/tmp/c.wav"];

  it.each([
    [0, 0],
    [255, 0],
    [undefined, 0],
    [1, 1],
    [69, 1],
  ])("ffmpeg exit %s makes the recorder exit %s", async (exit, want) => {
    const r = await record({ argv, drive: ({ on }) => on.exit?.(exit) });
    expect(r.code).toBe(want);
  });

  it("a spawn error fails the recorder with its message", async () => {
    const r = await record({ argv, drive: spawnFails });
    expect(r.code).toBe(1);
    expect(r.errs).toStrictEqual(["spawn ffmpeg ENOENT"]);
  });
});
