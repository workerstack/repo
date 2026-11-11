import fs from "node:fs";
import { plantProgram } from "../fixtures/stub-bin.ts";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NEED_FFMPEG } from "./listen.ts";
import {
  killTable,
  plantSession,
  readSession,
  recorder,
  repoBin,
  run,
  tmp,
  which,
  cleanupTmp,
} from "./fixtures/listen-env.ts";

afterEach(cleanupTmp);

describe("start", () => {
  it("needs ffmpeg", async () => {
    const r = await run(["start"], { whichFn: which({}) });
    expect(r.errs).toStrictEqual([NEED_FFMPEG]);
  });

  it("spawns a detached recorder through bin/repo.ts, records its pid and prints it", async () => {
    const rec = recorder();
    const env = { OPENAI_API_KEY: "k", HOME: "/h" };
    const r = await run(["start"], { spawnFn: rec.spawnFn, nodeBin: "/custom/bun", env });
    const call = rec.spawned[0];
    const wav = String(readSession(r.cwd).wav);
    expect(r.code).toBe(0);
    expect(call?.bin).toBe("/custom/bun");
    expect(call?.args).toStrictEqual([repoBin(), "listen", "_record", "--out", wav, "--cwd", r.cwd]);
    expect(call?.opts).toMatchObject({ detached: true, cwd: r.cwd, windowsHide: true, env });
    expect(path.dirname(wav)).toBe(path.join(r.cwd, ".tmp/repo/listen"));
    expect(readSession(r.cwd)).toMatchObject({ pid: 5150 });
    expect(rec.unrefs()).toBe(1);
    expect(r.logs).toStrictEqual([`recording pid=5150\n${wav}`]);
  });

  it("works with a child that cannot be unref'd", async () => {
    const rec = recorder(77, false);
    const r = await run(["start"], { spawnFn: rec.spawnFn });
    expect(r.code).toBe(0);
    expect(readSession(r.cwd)).toMatchObject({ pid: 77 });
  });
});

describe("start device", () => {
  it("passes --device from the flag", async () => {
    const rec = recorder();
    await run(["start", "--device", ":3"], { spawnFn: rec.spawnFn });
    expect(rec.spawned[0]?.args.slice(-4, -2)).toStrictEqual(["--device", ":3"]);
  });

  it("passes --device from the configuration", async () => {
    const rec = recorder();
    await run(["start"], { spawnFn: rec.spawnFn, env: { OPENAI_API_KEY: "k", LISTEN_DEVICE: ":9" } });
    expect(rec.spawned[0]?.args).toContain(":9");
  });

  it("passes no --device otherwise", async () => {
    const rec = recorder();
    await run(["start"], { spawnFn: rec.spawnFn });
    expect(rec.spawned[0]?.args).not.toContain("--device");
  });
});

describe("start session", () => {
  it("refuses to start while a recorder is alive", async () => {
    const cwd = tmp("listen-start-alive-");
    plantSession(cwd, { pid: 900 });
    const rec = recorder();
    const r = await run(["start"], { cwd, spawnFn: rec.spawnFn, killFn: killTable([900]).killFn });
    expect(r.code).toBe(1);
    expect(r.errs).toStrictEqual(["already recording pid=900"]);
    expect(rec.spawned).toStrictEqual([]);
  });

  it("replaces a stale or pid-less session", async () => {
    const cwd = tmp("listen-start-stale-");
    plantSession(cwd, { pid: 900 });
    const rec = recorder();
    const stale = await run(["start"], { cwd, spawnFn: rec.spawnFn, killFn: killTable([]).killFn });
    expect(stale.code).toBe(0);
    plantSession(cwd, { wav: "/x" });
    await run(["start"], { cwd, spawnFn: rec.spawnFn });
    expect(rec.spawned).toHaveLength(2);
  });
});

describe("start with the default spawn", () => {
  it("launches the recorder for real and it receives the right argv", async () => {
    const dir = tmp("listen-start-real-");
    const argsFile = path.join(dir, "args.txt");
    // Started by its path with no shell, so on win32 it is a compiled program, not a script.
    const js = `import fs from "node:fs";
fs.writeFileSync(${JSON.stringify(`${argsFile}.tmp`)}, process.argv.slice(2).join("\\n") + "\\n");
fs.renameSync(${JSON.stringify(`${argsFile}.tmp`)}, ${JSON.stringify(argsFile)});
`;
    const stub = plantProgram(dir, "stub-bun", js);
    const r = await run(["start"], { nodeBin: stub });
    const wav = String(readSession(r.cwd).wav);
    await vi.waitFor(() => expect(fs.existsSync(argsFile)).toBe(true), { timeout: 5000 });
    const got = fs.readFileSync(argsFile, "utf8").split("\n").slice(0, 6);
    expect(r.code).toBe(0);
    expect(got).toStrictEqual([repoBin(), "listen", "_record", "--out", wav, "--cwd"]);
  }, 60_000);
});
