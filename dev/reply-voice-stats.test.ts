import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { replyVoiceStats, run } from "./reply-voice-stats.ts";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { force: true, recursive: true });
});

function reply(text: string, timestamp: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    isSidechain: false,
    message: { content: [{ text, type: "text" }], role: "assistant" },
    timestamp,
    type: "assistant",
    ...extra,
  });
}

function transcriptRoot(lines: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "voice-stats-"));
  tmpDirs.push(root);
  fs.mkdirSync(path.join(root, "proj"));
  fs.writeFileSync(path.join(root, "proj", "s.jsonl"), `${lines.join("\n")}\n`);

  return root;
}

describe("replyVoiceStats", () => {
  it("counts arrows and key=value tokens in main-thread replies outside code", () => {
    const root = transcriptRoot([
      reply("Plan saved → next run tests. serial=15 path=.tmp/x", "2026-11-01T10:00:00Z"),
      reply(
        "I fixed the hook. You approve the wording.\n```\na -> b\nk=v\n```\nUse `x=1` here.",
        "2026-11-01T10:01:00Z",
      ),
      reply("hidden → child", "2026-11-01T10:02:00Z", { isSidechain: true }),
      JSON.stringify({
        message: { content: "a → b k=v", role: "user" },
        timestamp: "2026-11-01T10:03:00Z",
        type: "user",
      }),
      reply("old → reply", "2026-10-01T10:00:00Z"),
      "not json",
    ]);

    expect(replyVoiceStats({ root, since: "2026-10-15" })).toStrictEqual({
      arrows: 1,
      coldReplies: 1,
      keyValues: 2,
      replies: 2,
    });
  });
});

describe("run", () => {
  it("prints one JSON line with the root, the since flag and the stats, and exits 0", () => {
    const root = transcriptRoot([reply("a -> b k=v", "2026-11-01T10:00:00Z"), reply("plain", "2026-11-01T10:01:00Z")]);
    const lines: string[] = [];

    const code = run(["--root", root, "--since", "2026-10-15"], {
      err: () => {},
      out: (line) => lines.push(line),
    });

    expect(code).toBe(0);
    expect(lines).toStrictEqual([
      JSON.stringify({
        // The line's order: the root and the since flag, then the stats.
        root,
        since: "2026-10-15",

        arrows: 1,
        coldReplies: 1,
        keyValues: 1,
        replies: 2,
      }),
    ]);
  });
});
