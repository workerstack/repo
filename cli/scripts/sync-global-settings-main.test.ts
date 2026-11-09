import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { main } from "./sync-global-settings.ts";
import { captureStreams, plant, plantDirs } from "./fixtures/sync-global-kit.ts";

const tmp = plantDirs();

const DESTS = [
  ".grok/config.toml",
  ".claude/settings.json",
  ".codex/config.toml",
  ".gemini/antigravity-cli/settings.json",
  ".cursor/cli-config.json",
];
const IDS = ["grok", "claude", "codex", "antigravity", "cursor"];

let home: string;
let cwd: string;

/** Plant a home and a project cwd with a clean project grok config; main reads the stock manifest from the package. */
beforeEach(() => {
  home = tmp("yolo-main-home-");
  cwd = tmp("yolo-main-cwd-");
  plant(cwd, ".grok/config.toml", "[plugins]\nenabled = []\n");
  vi.stubEnv("HOME", home);
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
});

afterEach(() => vi.restoreAllMocks());

it("main apply and dry-run: applies by default, printing one apply line per host and writing under the planted home", () => {
  const streams = captureStreams();
  expect(main([])).toBe(0);
  expect(streams.out().trim().split("\n")).toEqual(IDS.map((id, i) => `apply ${id} ${DESTS[i]}`));
  expect(streams.err()).toBe("");
  for (const dest of DESTS) expect(fs.existsSync(path.join(home, dest))).toBe(true);
});

it("main apply and dry-run: --dry-run prints dry-run lines and writes nothing", () => {
  const streams = captureStreams();
  expect(main(["--dry-run"])).toBe(0);
  expect(streams.out().trim().split("\n")).toEqual(IDS.map((id, i) => `dry-run ${id} ${DESTS[i]}`));
  expect(fs.existsSync(path.join(home, ".grok"))).toBe(false);
});

it("main apply and dry-run: an unknown host exits 1 on stderr", () => {
  const streams = captureStreams();
  expect(main(["--host", "gemini"])).toBe(1);
  expect(streams.err()).toBe("unknown host: gemini\n");
  expect(streams.out()).toBe("");
});

it("main apply and dry-run: a bad flag exits 1 on stderr", () => {
  const streams = captureStreams();
  expect(main(["--apply"])).toBe(1);
  expect(streams.err()).toBe("unknown flag: --apply\n");
});

it("main apply and dry-run: an empty HOME exits 1 saying HOME is required", () => {
  vi.stubEnv("HOME", "");
  const streams = captureStreams();
  expect(main([])).toBe(1);
  expect(streams.err()).toBe("HOME required\n");
});

it("main apply and dry-run: an unreadable dest exits 1 after printing the hosts already written", () => {
  plant(home, ".claude/settings.json", "{");
  const streams = captureStreams();
  expect(main([])).toBe(1);
  expect(streams.out()).toBe("apply grok .grok/config.toml\n");
  expect(streams.err()).toBe("unreadable dest: .claude/settings.json\n");
});

it("main apply and dry-run: a failing stdout write exits 1 with the thrown message", () => {
  const streams = captureStreams();
  vi.spyOn(process.stdout, "write").mockImplementation(() => {
    throw new Error("EPIPE");
  });
  expect(main([])).toBe(1);
  expect(streams.err()).toBe("EPIPE\n");
});

it("main apply and dry-run: reports a thrown non-Error value as text", () => {
  const streams = captureStreams();
  vi.spyOn(process.stdout, "write").mockImplementation(() => {
    throw "closed";
  });
  expect(main([])).toBe(1);
  expect(streams.err()).toBe("closed\n");
});

it("main --check: lists every host missing, then the hint, and exits 1", () => {
  const streams = captureStreams();
  expect(main(["--check"])).toBe(1);
  const [line, hint] = streams.out().trim().split("\n");
  expect((line ?? "").split(" · ").map((p) => p.split(" ")[0])).toEqual(IDS);
  expect(line).toContain("grok missing");
  expect(hint).toBe("run `bun repo yolo`");
  expect(streams.err()).toBe("");
});

it("main --check: prints every host ok after an apply and exits 0 without a hint", () => {
  const streams = captureStreams();
  main([]);
  streams.reset();
  expect(main(["--check"])).toBe(0);
  expect(streams.out()).toBe(`${IDS.map((id) => `${id} ok`).join(" · ")}\n`);
  expect(streams.err()).toBe("");
});

it("main --check: exits 1 on an unreadable dest alone, with no hint and no project error", () => {
  const streams = captureStreams();
  main([]);
  fs.writeFileSync(path.join(home, ".cursor/cli-config.json"), "{");
  streams.reset();
  expect(main(["--check"])).toBe(1);
  expect(streams.out()).toBe(`${IDS.map((id) => `${id} ${id === "cursor" ? "unreadable" : "ok"}`).join(" · ")}\n`);
  expect(streams.err()).toBe("");
});

it("main --check: exits 1 on a project config error even when every host is ok", () => {
  const streams = captureStreams();
  main([]);
  fs.writeFileSync(path.join(cwd, ".grok/config.toml"), "[features]\nx = true\n");
  streams.reset();
  expect(main(["--check"])).toBe(1);
  expect(streams.out()).toBe(`${IDS.map((id) => `${id} ok`).join(" · ")}\n`);
  expect(streams.err()).toBe("project .grok/config.toml must not set [features] or [agent]\n");
});

it("main --check: an unknown host with --check exits 1 on stderr", () => {
  const streams = captureStreams();
  expect(main(["--check", "--host=gemini"])).toBe(1);
  expect(streams.err()).toBe("unknown host: gemini\n");
  expect(streams.out()).toBe("");
});
