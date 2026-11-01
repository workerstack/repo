import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { replyVoiceStats } from "./reply-voice-stats.mjs";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function reply(text: string, timestamp: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "assistant",
    isSidechain: false,
    timestamp,
    message: { role: "assistant", content: [{ type: "text", text }] },
    ...extra,
  });
}

function transcriptRoot(lines: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "voice-stats-"));
  tmpDirs.push(root);
  fs.mkdirSync(path.join(root, "proj"));
  fs.writeFileSync(path.join(root, "proj", "s.jsonl"), lines.join("\n") + "\n");
  return root;
}

describe("replyVoiceStats", () => {
  it("counts arrows and key=value tokens in main-thread replies outside code", () => {
    const root = transcriptRoot([
      reply("Plan saved → next run tests. serial=15 path=.tmp/x", "2026-11-01T10:00:00Z"),
      reply("I fixed the hook. You approve the wording.\n```\na -> b\nk=v\n```\nUse `x=1` here.", "2026-11-01T10:01:00Z"),
      reply("hidden → child", "2026-11-01T10:02:00Z", { isSidechain: true }),
      JSON.stringify({ type: "user", timestamp: "2026-11-01T10:03:00Z", message: { role: "user", content: "a → b k=v" } }),
      reply("old → reply", "2026-10-01T10:00:00Z"),
      "not json",
    ]);
    expect(replyVoiceStats({ root, since: "2026-10-15" })).toEqual({
      replies: 2,
      coldReplies: 1,
      arrows: 1,
      keyValues: 2,
    });
  });
});
