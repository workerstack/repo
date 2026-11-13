import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { tempDir, useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { repoRoot } from "./__fixtures__/sync-global-kit.ts";
import { checkGlobals, checkHosts, checkLine } from "./check-globals.ts";
import { deepMerge } from "./deep-merge.ts";
import { skipReason } from "./global-settings-files.ts";
import { syncGlobals } from "./sync-global-settings.ts";

useTempDirs();

type Rule = { action: string; effect: string; resource: string };

const DEST = ".config/opencode/opencode.json";
const ALLOW: Rule = { action: "*", effect: "allow", resource: "*" };
const DENY: Rule = { action: "shell", effect: "deny", resource: "rm *" };

function plant(home: string, body: string, rel = DEST): string {
  const abs = path.join(home, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);

  return abs;
}

function applyOpencode(home: string) {
  return syncGlobals({ apply: true, home, host: "opencode", workspaceRoot: repoRoot });
}

function readRules(home: string): Rule[] {
  const dest = JSON.parse(fs.readFileSync(path.join(home, DEST), "utf8")) /* a file this test just wrote */ as {
    permissions: Rule[];
  };

  return dest.permissions;
}

function lines(home: string): string[] {
  return applyOpencode(home).report.map((r) => r.line);
}

function status(home: string) {
  return checkHosts({ home, host: "opencode", workspaceRoot: repoRoot });
}

describe("opencode host: apply", () => {
  it("creates the dest and its missing directory with the allow-all rule", () => {
    const home = tempDir("oc-new-");

    expect(lines(home)).toStrictEqual([`apply opencode ${DEST}`]);
    expect(readRules(home)).toStrictEqual([ALLOW]);
  });

  it("keeps the user's rules after ours and never duplicates ours on a second apply", () => {
    const home = tempDir("oc-keep-");
    plant(home, JSON.stringify({ permissions: [DENY], theme: "system" }));

    expect(applyOpencode(home).ok).toBe(true);
    expect(readRules(home)).toStrictEqual([ALLOW, DENY]);
    const first = fs.readFileSync(path.join(home, DEST), "utf8");

    expect(applyOpencode(home).ok).toBe(true);
    expect(fs.readFileSync(path.join(home, DEST), "utf8")).toBe(first);
    expect(JSON.parse(first)).toMatchObject({ theme: "system" });
  });

  it("dry-run writes nothing", () => {
    const home = tempDir("oc-dry-");

    expect(syncGlobals({ apply: false, home, host: "opencode", workspaceRoot: repoRoot }).ok).toBe(true);
    expect(fs.existsSync(path.join(home, ".config"))).toBe(false);
  });
});

describe("opencode host: a dest left as it is", () => {
  it("skips a dest whose permissions is not an array", () => {
    const home = tempDir("oc-obj-");
    const abs = plant(home, JSON.stringify({ permissions: { "*": "allow" } }));
    const before = fs.readFileSync(abs, "utf8");

    expect(lines(home)).toStrictEqual([`skip opencode ${DEST}: permissions is not an array`]);
    expect(fs.readFileSync(abs, "utf8")).toBe(before);
  });

  it("skips when an opencode.jsonc sits beside it", () => {
    const home = tempDir("oc-jsonc-");
    plant(home, "{}", ".config/opencode/opencode.jsonc");

    expect(lines(home)).toStrictEqual([`skip opencode ${DEST}: opencode.jsonc exists`]);
    expect(fs.existsSync(path.join(home, DEST))).toBe(false);
  });
});

describe("opencode host: check", () => {
  it("is ok with the rule anywhere in the dest array, and drifts when it is missing", () => {
    const home = tempDir("oc-chk-");
    plant(home, JSON.stringify({ permissions: [DENY, ALLOW] }));
    expect(checkLine(status(home))).toBe("opencode ok");
    plant(home, JSON.stringify({ permissions: [DENY] }));
    expect(checkLine(status(home))).toBe("opencode differs permissions");
  });

  it("reports a skipped host with its reason, and checkGlobals names it as an error", () => {
    const home = tempDir("oc-chk-skip-");
    plant(home, JSON.stringify({ permissions: "allow" }));
    expect(checkLine(status(home))).toBe("opencode skipped: permissions is not an array");
    expect(checkGlobals({ home, workspaceRoot: repoRoot }).error).toContain(
      `opencode ${DEST} skipped: permissions is not an array`,
    );
  });
});

describe("deepMerge arrays of objects", () => {
  it("puts source objects missing from dest first and keeps dest ones", () => {
    expect(deepMerge({ a: [DENY] }, { a: [ALLOW] }, null)).toStrictEqual({ a: [ALLOW, DENY] });
    expect(deepMerge({ a: [ALLOW, DENY] }, { a: [ALLOW] }, null)).toStrictEqual({ a: [ALLOW, DENY] });
  });

  it("still replaces arrays of anything else", () => {
    expect(deepMerge({ a: ["x"] }, { a: ["y"] }, null)).toStrictEqual({ a: ["y"] });
    expect(deepMerge({ a: [1] }, { a: [{ k: 1 }] }, null)).toStrictEqual({ a: [{ k: 1 }] });
  });
});

describe("skipReason", () => {
  it("names a nested key whose rules would replace a non-array", () => {
    const dest = path.join(tempDir("oc-skip-"), "a.toml");

    expect(skipReason(dest, { a: { b: "text" } }, { a: { b: [{ k: 1 }] } })).toBe("a.b is not an array");
    expect(skipReason(dest, { a: { b: [] } }, { a: { b: [{ k: 1 }] } })).toBeNull();
    expect(skipReason(dest, { a: 1 }, { a: { b: [{ k: 1 }] } })).toBeNull();
  });
});
