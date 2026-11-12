import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { alive, BOOT, plantHome, probeOf } from "./__fixtures__/board-kit.ts";
import { otherLines, recordHook } from "./board-hook.ts";
import { lines } from "./board.ts";

const boot = BOOT;
const deps = { boot, identity: { pid: 30, start: "100" }, now: "2026-10-09T12:00:00Z", probe: alive };

function env(dir: string) {
  return { CLAUDE_PROJECT_DIR: "/home/user/x", REPO_BOARD_HOME: dir };
}

function rendered(dir: string): string {
  return lines({ boot, home: dir, probe: alive }).join("\n");
}

/** The work label a prompt leaves on the board. */
function label(prompt: string): string {
  const dir = plantHome();
  recordHook({ prompt, session_id: "sid" }, env(dir), deps);

  return rendered(dir).replace("2026-10-09T12:00:00Z claude - - sid /home/user/x ", "");
}

it("keeps pasted content out of other sessions' lines", () => {
  const dir = plantHome();
  recordHook(
    {
      prompt:
        'check this <pasted_content id="ab12">Username alice9 Password hunter2hunter2</pasted_content id="ab12"> now',
      session_id: "sid",
    },
    env(dir),
    deps,
  );

  const text = otherLines({ session_id: "viewer" }, env(dir), {
    boot,
    probe: probeOf({ 30: {}, 31: { start: "101" } }),
  });

  expect(text).toContain("check this now");
  expect(text).not.toContain("alice9");
  expect(text).not.toContain("hunter2");
});

it("redacts secret-shaped values", () => {
  expect(label("deploy with token ghp_abcdefghijklmnopqrstuvwxyz0123")).toBe("deploy with token [redacted]");
  expect(label("password: s3cr3t")).toBe("password: [redacted]");
  expect(label("key Xk9pQ2mN7vR4tL8wZ3yB6cD1")).toBe("key [redacted]");
});

it("leaves ordinary words, paths, slugs and SHAs intact", () => {
  for (const text of [
    "ship the auth fix",
    "bypass the cache",
    "ask the user which flow",
    "fix task-list and disk-usage",
    "look at /home/dev/acme/projects/shop",
    "plan 20-board-drops-pasted-secrets",
    "revert 9fb96064c3a1e2b5d7f8091a2b3c4d5e6f708192",
  ])
    expect(label(text)).toBe(text);
});

it("drops image markers and keeps the previous label for a paste-only prompt", () => {
  expect(label("[Image #9] review this")).toBe("review this");
  const dir = plantHome();
  recordHook({ prompt: "write the blog post", session_id: "sid" }, env(dir), deps);
  recordHook(
    { prompt: '<pasted_content id="x1">Username alice9</pasted_content id="x1">', session_id: "sid" },
    env(dir),
    deps,
  );
  expect(rendered(dir)).toContain("write the blog post");
  expect(rendered(dir)).not.toContain("alice9");
});

it("cleans a cut-off row already on disk", () => {
  const dir = plantHome();
  const board = path.join(dir, ".workerstack", "board");
  fs.mkdirSync(board, { recursive: true });

  const row = {
    boot,
    cwd: "/home/user/x",
    effort: "-",
    model: "-",
    pid: 30,
    provider: "claude",
    session: "old",
    start: "100",
    time: "2026-10-09T12:00:00Z",
    work: '[Image #9] <pasted_content id="c3cb"> Username alice9 Password hunter2',
  };

  fs.writeFileSync(path.join(board, "claude-old.json"), `${JSON.stringify(row)}\n`);
  const text = rendered(dir);
  expect(text).toContain("old");
  expect(text).not.toContain("pasted_content");
  expect(text).not.toContain("alice9");
  expect(text).not.toContain("hunter2");
});

it("drops every injected block and keeps the typed slash command", () => {
  expect(label('<cross-session-message from="uds:/run/x.sock">Area D done</cross-session-message> ok')).toBe("ok");
  expect(label('<agent-message from="a1">secret notes')).toBe("active");
  expect(label('<cross-session-message from="uds:/run/user/1000/cc-socks/2679701.sock" from-name')).toBe("active");
  expect(label("<command-name>/review-plan</command-name> <command-args>23</command-args>")).toBe("/review-plan 23");
});

it("redacts each secret once across write and render", () => {
  const out = label("use password=abc123 and sk-abcdefghijklmnopqrstuv");
  expect(out).toBe("use password=[redacted] and [redacted]");
  expect(out.match(/\[redacted\]/g)).toHaveLength(2);
});
