import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AV,
  clipboard,
  killTable,
  plantSession,
  plantWav,
  run,
  textFetch,
  tmp,
  which,
  cleanupTmp,
} from "./fixtures/listen-env.ts";
import { sessionPath } from "./listen-session.ts";
import { NEED_FFMPEG } from "./listen.constants.ts";

afterEach(cleanupTmp);

describe("devices", () => {
  it("lists devices as id and name", async () => {
    const r = await run(["devices"], { spawnSyncFn: () => ({ status: 1, stderr: AV }) });
    expect(r.logs).toStrictEqual([":0  MacBook Pro Microphone"]);
  });

  it("says so when there are none", async () => {
    const r = await run(["devices"], { spawnSyncFn: () => ({ status: 1 }) });
    expect(r.code).toBe(0);
    expect(r.logs).toStrictEqual(["no audio devices"]);
  });

  it("needs ffmpeg", async () => {
    const r = await run(["devices"], { whichFn: which({}) });
    expect(r.code).toBe(1);
    expect(r.errs).toStrictEqual([NEED_FFMPEG]);
  });
});

describe("latest", () => {
  it("fails without a transcript", async () => {
    const r = await run(["latest"]);
    expect(r.code).toBe(1);
    expect(r.errs).toStrictEqual(["no transcript"]);
  });

  it("prints the saved transcript", async () => {
    const cwd = tmp("listen-latest-");
    await run(["file", "--path", plantWav(cwd)], { cwd, fetchFn: textFetch("saved words") });
    expect((await run(["latest"], { cwd })).logs).toStrictEqual(["saved words"]);
  });
});

describe("status", () => {
  it("is idle without a session or without a pid", async () => {
    const cwd = tmp("listen-st-idle-");
    expect((await run(["status"], { cwd })).logs).toStrictEqual(["idle"]);
    plantSession(cwd, { wav: "/x.wav" });
    expect((await run(["status"], { cwd })).logs).toStrictEqual(["idle"]);
  });

  it("reports a live recorder through the default probe, keeping the session", async () => {
    const cwd = tmp("listen-st-live-");
    plantSession(cwd, { pid: process.pid, wav: "/x.wav" });
    const r = await run(["status"], { cwd });
    expect(r.logs).toStrictEqual([`recording  pid=${process.pid}  wav=/x.wav`]);
    expect(fs.existsSync(sessionPath(cwd))).toBe(true);
  });

  it("reports a stale session and clears it", async () => {
    const cwd = tmp("listen-st-stale-");
    plantSession(cwd, { pid: 4242 });
    const r = await run(["status"], { cwd, killFn: killTable([]).killFn });
    expect(r.logs).toStrictEqual(["stale  pid=4242  wav=-"]);
    expect(fs.existsSync(sessionPath(cwd))).toBe(false);
  });
});

describe("file", () => {
  it.each([
    ["--path", (w: string) => ["file", "--path", w]],
    ["--file", (w: string) => ["file", "--file", w]],
    ["--out", (w: string) => ["file", "--out", w]],
    ["the second word", (w: string) => ["file", w]],
  ])("takes the path from %s", async (_label, argv) => {
    const cwd = tmp("listen-file-arg-");
    const r = await run(argv(plantWav(cwd)), { cwd, fetchFn: textFetch("heard") });
    expect(r.code).toBe(0);
    expect(r.logs[0]).toBe("heard");
  });

  it("fails without a path", async () => {
    const r = await run(["file"]);
    expect(r.code).toBe(1);
    expect(r.errs).toStrictEqual(["file needs --path"]);
  });
});

describe("file --clip", () => {
  it.each([[["--clip"]], [["--clip", "true"]]])("copies the transcript through pbcopy (%j)", async (flag) => {
    const cwd = tmp("listen-file-clip-");
    const clip = clipboard();
    const r = await run(["file", "--path", plantWav(cwd), ...flag], { cwd, fetchFn: textFetch("clip me"), ...clip });
    expect(r.code).toBe(0);
    expect(clip.inputs).toStrictEqual(["clip me"]);
  });

  it("a failing clipboard fails the command but the transcript is saved", async () => {
    const cwd = tmp("listen-file-clipfail-");
    const r = await run(["file", "--path", plantWav(cwd), "--clip"], {
      cwd,
      fetchFn: textFetch("kept"),
      ...clipboard(1),
    });
    expect(r.code).toBe(1);
    expect(r.errs).toStrictEqual(["pbcopy failed"]);
    expect(fs.readFileSync(path.join(cwd, ".tmp/repo/listen/latest.txt"), "utf8")).toBe("kept\n");
  });

  it("without --clip nothing touches the clipboard", async () => {
    const cwd = tmp("listen-file-noclip-");
    const clip = clipboard();
    await run(["file", "--path", plantWav(cwd)], { cwd, fetchFn: textFetch("x"), ...clip });
    expect(clip.inputs).toStrictEqual([]);
  });
});
