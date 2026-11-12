import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { deepMerge } from "./deep-merge.ts";
import { resolveDest, shouldSkip } from "./global-settings-files.ts";
import { parseArgv } from "./sync-global-settings.ts";

const skipRe = new RegExp(
  "^(secrets?|api[_-]?key|access[_-]?token|tokens?|passwords?|authorization|mcp(servers)?|hooks)$",
  "i",
);

it("applies by default and reads --dry-run, --check and --host", () => {
  expect(parseArgv([])).toStrictEqual({ check: false, dryRun: false, host: "all", ok: true });
  expect(parseArgv(["--dry-run"])).toMatchObject({ dryRun: true, ok: true });
  expect(parseArgv(["--check", "--host", "grok"])).toMatchObject({ check: true, host: "grok", ok: true });
  expect(parseArgv(["--host=claude"])).toMatchObject({ host: "claude", ok: true });
});

it("rejects a bad host or flag, and --check with --dry-run", () => {
  expect(parseArgv(["--host="])).toStrictEqual({ error: "unknown host: ", ok: false });
  expect(parseArgv(["--apply"])).toStrictEqual({ error: "unknown flag: --apply", ok: false });
  expect(parseArgv(["--host"]).ok).toBe(false);
  expect(parseArgv(["--check", "--dry-run"])).toStrictEqual({
    error: "--check and --dry-run do not combine",
    ok: false,
  });
});

it("rejects dest outside home", () => {
  const home = path.join(os.tmpdir(), "yolo-home");
  expect(() => resolveDest(home, "../.ssh/config")).toThrow("dest not under home: ../.ssh/config");
  expect(() => resolveDest(home, "/etc/passwd")).toThrow("dest not under home: /etc/passwd");
  expect(resolveDest(home, ".grok/config.toml")).toBe(path.resolve(home, ".grok/config.toml"));
});

it("skips mcp, hooks and apiKey keys", () => {
  expect(shouldSkip("hooks", skipRe)).toBe(true);
  expect(shouldSkip("mcp", skipRe)).toBe(true);
  expect(shouldSkip("apiKey", skipRe)).toBe(true);
  expect(shouldSkip("features", skipRe)).toBe(false);
});

it("keeps dest-only keys and skips mcp/hooks/apiKey", () => {
  const dest = {
    apiKey: "dest-secret",
    features: { hooks: "dest-hooks", two_pass_compaction: false },
    keepMe: 1,
    mcp: { servers: { old: true } },
  };

  const source = {
    agent: { name: "orchestrator" },
    apiKey: "src-secret",
    features: { hooks: "src-hooks", two_pass_compaction: true },
    hooks: { on: true },
    mcp: { servers: { new: true } },
  };

  const merged = deepMerge(dest, source, skipRe);
  expect(merged.keepMe).toBe(1);
  expect(merged.apiKey).toBe("dest-secret");
  expect(merged.mcp).toStrictEqual({ servers: { old: true } });
  expect(merged.hooks).toBeUndefined();
  expect(merged.features).toStrictEqual({ hooks: "dest-hooks", two_pass_compaction: true });
  expect(merged.agent).toStrictEqual({ name: "orchestrator" });
});
