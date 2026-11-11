import fs from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clipboard,
  killTable,
  plantSession,
  plantWav,
  readSession,
  recorder,
  recording,
  run,
  textFetch,
  tmp,
  cleanupTmp,
} from "./fixtures/listen-env.ts";
import { sessionPath } from "./listen-session.ts";

afterEach(cleanupTmp);

describe("stop", () => {
  it("fails when nothing is recording", async () => {
    const r = await run(["stop"]);
    expect(r.code).toBe(1);
    expect(r.errs).toStrictEqual(["not recording"]);
  });

  it("interrupts a live recorder, waits for it, transcribes and clears the session", async () => {
    const { cwd } = recording();
    const table = killTable([3000]);
    const waited: number[] = [];
    const waitPid = (pid: number) => void waited.push(pid);
    const r = await run(["stop"], { cwd, fetchFn: textFetch("stopped words"), killFn: table.killFn, waitPid });
    expect(r.code).toBe(0);
    expect(table.sent).toContainEqual([3000, "SIGINT"]);
    expect(waited).toStrictEqual([3000]);
    expect(r.logs[0]).toBe("stopped words");
    expect(fs.existsSync(sessionPath(cwd))).toBe(false);
  });

  it("skips the interrupt for a dead recorder and still transcribes what was recorded", async () => {
    const { cwd } = recording();
    const table = killTable([]);
    const r = await run(["stop"], { cwd, fetchFn: textFetch("from dead"), killFn: table.killFn });
    expect(r.code).toBe(0);
    expect(table.sent.some(([, sig]) => sig === "SIGINT")).toBe(false);
  });
});

describe("stop waiting", () => {
  it("still waits and transcribes when the interrupt itself throws", async () => {
    const { cwd } = recording();
    let probes = 0;
    const killFn = (_pid: number, sig: string | number) => {
      if (sig !== 0) throw new Error("EPERM");
      probes += 1;
      if (probes > 1) throw new Error("ESRCH");
      return true;
    };
    const r = await run(["stop"], { cwd, fetchFn: textFetch("after eperm"), killFn });
    expect(r.code).toBe(0);
    expect(r.logs[0]).toBe("after eperm");
  });

  it("polls the recorder until it exits when no waiter is injected", async () => {
    const { cwd } = recording();
    let probes = 0;
    const killFn = (_pid: number, sig: string | number) => {
      if (sig === 0 && ++probes > 3) throw new Error("ESRCH");
      return true;
    };
    const r = await run(["stop"], { cwd, fetchFn: textFetch("polled"), killFn });
    expect(r.code).toBe(0);
    expect(probes).toBe(4);
  });
});

describe("stop timeout", () => {
  it("gives up waiting after eight seconds", async () => {
    const { cwd } = recording();
    vi.useFakeTimers({ toFake: ["Date"] });
    let interrupted = false;
    const killFn = (_pid: number, sig: string | number) => {
      interrupted ||= sig === "SIGINT";
      if (interrupted && sig === 0) vi.setSystemTime(Date.now() + 9000);
      return true;
    };
    const r = await run(["stop"], { cwd, fetchFn: textFetch("late"), killFn });
    expect(r.code).toBe(0);
    expect(r.logs[0]).toBe("late");
  });
});

describe("stop failures", () => {
  it("fails when the session has no wav", async () => {
    const { cwd } = recording({ wav: null });
    const r = await run(["stop"], { cwd, killFn: killTable([]).killFn });
    expect(r.errs).toStrictEqual(["no wav from session"]);
    expect(fs.existsSync(sessionPath(cwd))).toBe(false);
  });

  it("fails when the wav is gone", async () => {
    const { cwd } = recording({ wav: "/nonexistent/rec.wav" });
    const r = await run(["stop"], { cwd, killFn: killTable([]).killFn });
    expect(r.errs).toStrictEqual(["no wav from session"]);
  });

  it("--clip copies the stopped transcript", async () => {
    const { cwd } = recording();
    const clip = clipboard();
    await run(["stop", "--clip"], { cwd, fetchFn: textFetch("to clipboard"), killFn: killTable([]).killFn, ...clip });
    expect(clip.inputs).toStrictEqual(["to clipboard"]);
  });
});

describe("toggle when idle", () => {
  it("starts a recorder, forwarding --device and --cwd", async () => {
    const dir = tmp("listen-tg-c-");
    const rec = recorder(8000);
    const r = await run(["toggle", "--device", ":4", "--cwd", dir], { cwd: tmp("listen-tg-o-"), spawnFn: rec.spawnFn });
    expect(r.code).toBe(0);
    expect(rec.spawned[0]?.args.slice(-4)).toStrictEqual(["--device", ":4", "--cwd", dir]);
    expect(readSession(dir)).toMatchObject({ pid: 8000 });
  });

  it("starts without forwarding anything it was not given", async () => {
    const plain = tmp("listen-tg-plain-");
    const rec = recorder(8000);
    await run(["toggle"], { cwd: plain, spawnFn: rec.spawnFn });
    expect(rec.spawned[0]?.args).not.toContain("--device");
    expect(readSession(plain)).toMatchObject({ pid: 8000 });
  });
});

describe("toggle when recording", () => {
  it("stops and transcribes, forwarding --clip and --cwd", async () => {
    const dir = tmp("listen-tg-stop-");
    plantSession(dir, { pid: 6000, wav: plantWav(dir, "t.wav") });
    const clip = clipboard();
    const killFn = killTable([6000]).killFn;
    const over = { cwd: tmp("listen-tg-o2-"), fetchFn: textFetch("toggled"), killFn, waitPid: () => {}, ...clip };
    const r = await run(["toggle", "--clip", "--cwd", dir], over);
    expect(r.logs[0]).toBe("toggled");
    expect(clip.inputs).toStrictEqual(["toggled"]);
    expect(fs.existsSync(sessionPath(dir))).toBe(false);
  });

  it("stops without clip when only the cwd option names the directory", async () => {
    const cwd = tmp("listen-tg-opt-");
    plantSession(cwd, { pid: 6001, wav: plantWav(cwd, "t.wav") });
    const clip = clipboard();
    const killFn = killTable([6001]).killFn;
    const r = await run(["toggle"], { cwd, fetchFn: textFetch("plain toggle"), killFn, waitPid: () => {}, ...clip });
    expect(r.logs[0]).toBe("plain toggle");
    expect(clip.inputs).toStrictEqual([]);
  });
});
