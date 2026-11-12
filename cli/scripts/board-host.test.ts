import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { alive, BOOT, plantHome, probeOf, writeRow } from "./__fixtures__/board-kit.ts";
import { otherLines, recordHook } from "./board-hook.ts";
import { hostIdentity, probeProcess } from "./board-process.ts";
import type { ProcessInfo } from "./board.types.ts";

const boot = BOOT;
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "board-process.ts");

/** Node 50 under shell 40 under the claude host 30. */
function chain(pid: number): ProcessInfo | null {
  if (pid === 50) return { comm: "node", pid: 50, ppid: 40, start: "1" };

  if (pid === 40) return { comm: "sh", pid: 40, ppid: 30, start: "2" };

  if (pid === 30) return { comm: "claude", pid: 30, ppid: 1, start: "3" };

  return null;
}

it("walks past a short-lived shell to the host process", () => {
  expect(hostIdentity({ pid: 50, probe: chain })).toStrictEqual({ pid: 30, start: "3" });
  expect(hostIdentity({ pid: 40, probe: chain })).toStrictEqual({ pid: 30, start: "3" });
});

it("probes linux without process.kill, and reads a zombie or an unreadable stat as gone", () => {
  const src = fs.readFileSync(script, "utf8");
  expect(src).not.toMatch(/process\.kill/);
  const live = "10 (my node) S 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 12345";
  expect(probeProcess(10, { platform: "linux", readFile: () => live })).toStrictEqual({
    comm: "my node",
    pid: 10,
    ppid: 1,
    start: "12345",
  });
  const stat = "10 (node) Z 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 12345";
  expect(probeProcess(10, { platform: "linux", readFile: () => stat })).toBeNull();
  expect(
    probeProcess(10, {
      platform: "linux",
      readFile: () => {
        throw new Error("enoent");
      },
    }),
  ).toBeNull();
});

it("probes darwin through ps", () => {
  const seen: string[][] = [];

  function ps(cmd: string, args: string[]) {
    seen.push([cmd, ...args]);

    return { status: 0, stdout: "11 Thu Oct  9 12:00:00 2026 /bin/zsh\n" };
  }

  expect(probeProcess(10, { platform: "darwin", spawn: ps })).toStrictEqual({
    comm: "zsh",
    pid: 10,
    ppid: 11,
    start: "Thu Oct  9 12:00:00 2026",
  });
  expect(seen[0]?.[0]).toBe("ps");
  expect(seen[0]).toContain("10");
});

it("probes windows through powershell", () => {
  const seen: string[] = [];

  function pwsh(cmd: string) {
    seen.push(cmd);

    return { status: 0, stdout: "11\ncmd.exe\n2026-10-09T12:00:00.0000000Z\n" };
  }

  expect(probeProcess(10, { platform: "win32", spawn: pwsh })).toStrictEqual({
    comm: "cmd.exe",
    pid: 10,
    ppid: 11,
    start: "2026-10-09T12:00:00.0000000Z",
  });
  expect(seen[0]).toMatch(/powershell/);
  expect(probeProcess(10, { platform: "win32", spawn: () => ({ status: 1, stdout: "" }) })).toBeNull();
});

it("recordHook writes the row and otherLines skips that session", () => {
  const dir = plantHome();
  const env = { CLAUDE_PROJECT_DIR: "/home/user/x", REPO_BOARD_HOME: dir };
  const deps = { boot, identity: { pid: 30, start: "100" }, now: "2026-10-09T12:00:00Z", probe: alive };
  expect(recordHook({ session_id: "" }, env, deps)).toBeNull();
  expect(recordHook({ session_id: "default" }, env, deps)).toBeNull();

  const data = {
    cwd: "/home/user/x",
    effort: { level: "medium" },
    model: "fable 51",
    prompt: "updating auth",
    session_id: "sid",
  };

  expect(recordHook(data, env, deps)?.work).toBe("updating auth");
  const both = probeOf({ 30: {}, 31: { start: "101" } });
  writeRow(dir, { pid: 31, probe: both, session: "other", start: "101", work: "other work" });
  const text = otherLines({ session_id: "sid" }, env, { boot, probe: both });
  expect(text).toContain("other work");
  expect(text).not.toContain("updating auth");
});
