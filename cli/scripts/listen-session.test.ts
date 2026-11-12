import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cleanupTmp, tmp } from "./__fixtures__/listen-env.ts";
import { latestPath, pidAlive, sessionPath } from "./listen-session.ts";

afterEach(cleanupTmp);

/** A kill probe that finds no such process. */
function gone(): never {
  throw new Error("ESRCH");
}

describe("paths", () => {
  it("listenDir lives under the repo root, whatever the depth", () => {
    const r = tmp("listen-paths-");
    spawnSync("git", ["init", "-q"], { cwd: r });
    const a = path.join(r, "packages", "a");
    fs.mkdirSync(a, { recursive: true });
    expect(sessionPath(a)).toBe(path.join(r, ".tmp/repo/listen/session.json"));
    expect(latestPath(a)).toBe(path.join(r, ".tmp/repo/listen/latest.txt"));
  });
});

describe("pidAlive", () => {
  it("is false for a non-positive or non-numeric pid without probing", () => {
    const probed: unknown[] = [];

    function kill(p: number) {
      return probed.push(p);
    }

    expect(pidAlive("abc", kill)).toBe(false);
    expect(pidAlive(0, kill)).toBe(false);
    expect(pidAlive(-4, kill)).toBe(false);
    expect(probed).toStrictEqual([]);
  });

  it("probes with signal 0 and maps a throw to false", () => {
    const sigs: unknown[] = [];
    expect(pidAlive("12", (_p, s) => sigs.push(s))).toBe(true);
    expect(sigs).toStrictEqual([0]);
    expect(pidAlive(12, gone)).toBe(false);
  });
});
