import { afterEach, expect, it, vi } from "vitest";

import { cleanSetup, plant } from "./fixtures/setup-kit.ts";
import { openUrl } from "./setup-oauth.ts";

afterEach(cleanSetup);

it("openUrl hands the url to openUrlFn and spawns nothing", async () => {
  const opened: string[] = [];
  const spawned: string[] = [];
  function spawnSyncFn(cmd: string) {
    return spawned.push(cmd);
  }
  await openUrl("https://x.test", { openUrlFn: (u) => opened.push(u), spawnSyncFn });
  expect(opened).toStrictEqual(["https://x.test"]);
  expect(spawned).toStrictEqual([]);
});

it("openUrl uses the platform's opener through spawnSyncFn", async () => {
  const calls: string[][] = [];
  function spawnSyncFn(cmd: string, args: string[]) {
    return calls.push([cmd, ...args]);
  }
  await openUrl("https://x.test", { platform: "darwin", spawnSyncFn });
  await openUrl("https://x.test", { platform: "win32", spawnSyncFn });
  await openUrl("https://x.test", { platform: "linux", spawnSyncFn });
  expect(calls).toStrictEqual([
    ["open", "https://x.test"],
    ["cmd", "/c", "start", "", "https://x.test"],
    ["xdg-open", "https://x.test"],
  ]);
});

it("openUrl falls back to the real opener, which finds nothing on an empty PATH", async () => {
  vi.stubEnv("PATH", plant("setup-open-empty-"));
  await expect(openUrl("https://x.test", { platform: "linux" })).resolves.toBeUndefined();
  await expect(openUrl("https://x.test")).resolves.toBeUndefined();
});
