import { describe, expect, it } from "vitest";

import { copyClip } from "./listen-clip.ts";
import type { SpawnSyncResult } from "./listen.types.ts";

type ClipCall = { cmd: string; args: string[]; opts: { input?: string; shell?: boolean } };

function clipRecorder(statuses: Record<string, number>) {
  const calls: ClipCall[] = [];
  const spawnSyncFn = (cmd: string, args: string[], opts: ClipCall["opts"]): SpawnSyncResult => {
    calls.push({ args, cmd, opts });
    return { status: statuses[cmd] ?? 1 };
  };
  return { calls, spawnSyncFn };
}

describe("copyClip", () => {
  it("pipes the text to pbcopy on darwin and fails loudly", () => {
    const ok = clipRecorder({ pbcopy: 0 });
    copyClip("hello", { platform: "darwin", ...ok });
    expect(ok.calls).toMatchObject([{ cmd: "pbcopy", opts: { input: "hello" } }]);
    expect(() => copyClip("x", { platform: "darwin", ...clipRecorder({}) })).toThrow("pbcopy failed");
  });

  it("uses clip through a shell on win32", () => {
    const ok = clipRecorder({ clip: 0 });
    copyClip("hello", { platform: "win32", ...ok });
    expect(ok.calls).toMatchObject([{ cmd: "clip", opts: { input: "hello", shell: true } }]);
    expect(() => copyClip("x", { platform: "win32", ...clipRecorder({}) })).toThrow("clip failed");
  });

  it("tries wl-copy, xclip, then xsel on linux and stops at the first that works", () => {
    const second = clipRecorder({ xclip: 0 });
    copyClip("hello", { platform: "linux", ...second });
    expect(second.calls.map((c) => c.cmd)).toStrictEqual(["wl-copy", "xclip"]);
    expect(second.calls[1]?.args).toStrictEqual(["-selection", "clipboard"]);
    const none = clipRecorder({});
    expect(() => copyClip("x", { platform: "linux", ...none })).toThrow("no wl-copy, xclip, or xsel on PATH");
    expect(none.calls.map((c) => c.cmd)).toStrictEqual(["wl-copy", "xclip", "xsel"]);
  });
});
