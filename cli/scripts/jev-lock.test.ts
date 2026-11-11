import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { answerBody, go, lockPath, plantDir, plantLock, reply, scripted } from "./__fixtures__/jev-kit.ts";
import { LOCK_STALE_MS } from "./jev.constants.ts";

afterEach(() => vi.restoreAllMocks());

function ok() {
  return scripted(reply(200, answerBody()));
}

/** Removes the directory a call names, then fails the call as if the owner had beaten it to it. */
function removeThenFail(target: string) {
  return () => {
    fs.rmdirSync(target);
    throw new Error("ENOENT");
  };
}

/** The exit code of one call in `home` that the service answers. */
async function okCode(home: string): Promise<number> {
  const result = await go({ fetchImpl: ok(), home });
  return result.code;
}

/** `okCode` when the first lock removal finds the directory already gone. */
function okCodeWhenRemoveRaced(home: string): Promise<number> {
  vi.spyOn(fs, "rmdirSync").mockImplementationOnce(removeThenFail(lockPath(home)));
  return okCode(home);
}

it("reclaims a stale lock and runs", async () => {
  const home = plantDir();
  plantLock(home);
  const old = new Date(Date.now() - 2 * LOCK_STALE_MS);
  fs.utimesSync(lockPath(home), old, old);
  expect(await okCode(home)).toBe(0);
  expect(fs.existsSync(lockPath(home))).toBe(false);
});

it("reclaims a lock that vanishes while it is checked, even when the owner removes it first", async () => {
  const home = plantDir();
  plantLock(home);
  vi.spyOn(fs, "statSync").mockImplementationOnce(() => {
    throw new Error("ENOENT");
  });
  expect(await okCodeWhenRemoveRaced(home)).toBe(0);
});

it("reports a busy lock after waiting out the stale window", async () => {
  const home = plantDir();
  plantLock(home);
  const future = new Date(Date.now() + 3_600_000);
  fs.utimesSync(lockPath(home), future, future);
  let clock = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => (clock += 6000));
  const fetchImpl = ok();
  expect(await go({ fetchImpl, home })).toStrictEqual({ code: 2, text: "jev usage lock busy\n" });
  expect(fetchImpl.calls).toBe(0);
});

it("waits for a lock that its owner releases", async () => {
  const home = plantDir();
  plantLock(home);
  const realStat = fs.statSync.bind(fs) /* the one-argument form returns Stats */ as (target: string) => fs.Stats;
  vi.spyOn(fs, "statSync").mockImplementationOnce((target) => {
    const seen = realStat(String(target));
    fs.rmdirSync(String(target));
    return seen;
  });
  expect(await okCode(home)).toBe(0);
});

it("lets the lock release fail without failing the call", async () => {
  const home = plantDir();
  expect(await okCodeWhenRemoveRaced(home)).toBe(0);
});

it("rejects when taking the lock fails for another reason", async () => {
  const home = plantDir();
  fs.mkdirSync(path.join(home, ".workerstack"));
  const real = fs.mkdirSync.bind(fs);
  vi.spyOn(fs, "mkdirSync").mockImplementation((target, options) => {
    if (String(target) === lockPath(home)) throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    return real(target, options);
  });
  await expect(go({ fetchImpl: ok(), home })).rejects.toThrow("EACCES");
});
