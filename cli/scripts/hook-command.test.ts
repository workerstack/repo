import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOOK_NAMES, HOOK_USAGE, hookCommand, hookNameOf, isHookName } from "./hook-command.ts";

const OLD_FORM = (rel: string) =>
  `d="\${GROK_WORKSPACE_ROOT:-\${CLAUDE_PROJECT_DIR:-.}}"; [ -e "$d/${rel}" ] || d="$(git -C "$d" rev-parse --show-toplevel 2>/dev/null || echo "$d")"; bun "$d/${rel}"`;

describe("hook names", () => {
  it("names hooks, and nothing else", () => {
    expect(isHookName("gate-fat-tools")).toBe(true);
    expect(isHookName("nope")).toBe(false);
    expect(isHookName("toString")).toBe(false);
    expect(isHookName(undefined)).toBe(false);
    expect(HOOK_USAGE).toBe(
      "use gate-fat-tools, orchestrate-parent, rtk-grok, scrub-spawn-prompt, session-map or worktree",
    );
  });
});

describe("hookCommand", () => {
  it("finds the root, then runs the installed bin", () => {
    expect(hookCommand("gate-fat-tools")).toBe(
      'd="${GROK_WORKSPACE_ROOT:-${CLAUDE_PROJECT_DIR:-.}}"; b=node_modules/.bin/repo; [ -e "$d/$b" ] || [ -e "$d/$b.exe" ] || d="$(git -C "$d" rev-parse --show-toplevel 2>/dev/null || echo "$d")"; r="$d/$b"; [ -e "$r" ] || [ ! -e "$r.exe" ] || r="$r.exe"; [ -x "$r" ] || { echo "repo: $d/$b is missing; run bun install" >&2; exit 1; }; "$r" hook gate-fat-tools',
    );
  });

  it("runs the bin in the project dir with the hook's stdin", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hook-cmd-"));
    const bin = path.join(dir, "node_modules", ".bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "repo"), '#!/bin/sh\necho "$@"; cat\n', { mode: 0o755 });
    const r = spawnSync("sh", ["-c", hookCommand("session-map")], {
      env: { PATH: process.env.PATH, CLAUDE_PROJECT_DIR: dir },
      input: "payload",
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("hook session-map\npayload");
  });

  it("runs the repo.exe a Windows install links when there is no plain repo", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hook-cmd-")));
    spawnSync("git", ["init", "-q"], { cwd: root });
    const pkg = path.join(root, "packages", "a");
    fs.mkdirSync(pkg, { recursive: true });
    const bin = path.join(root, "node_modules", ".bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "repo.exe"), '#!/bin/sh\necho "exe $@"\n', { mode: 0o755 });
    for (const env of [{ CLAUDE_PROJECT_DIR: root }, { CLAUDE_PROJECT_DIR: pkg }]) {
      const r = spawnSync("sh", ["-c", hookCommand("session-map")], { cwd: pkg, env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
      expect(r.stderr).toBe("");
      expect(r.stdout).toBe("exe hook session-map\n");
    }
  });

  it("says run bun install and exits 1 in a checkout with no install", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hook-cmd-"));
    const r = spawnSync("sh", ["-c", hookCommand("gate-fat-tools")], {
      cwd: dir,
      env: { PATH: process.env.PATH, CLAUDE_PROJECT_DIR: dir },
      encoding: "utf8",
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe(`repo: ${dir}/node_modules/.bin/repo is missing; run bun install\n`);
  });
});

describe("hookNameOf", () => {
  it.each(HOOK_NAMES)("reads %s back from its command", (name) => {
    expect(hookNameOf(hookCommand(name))).toBe(name);
  });

  it("reads the old direct script forms", () => {
    expect(hookNameOf(OLD_FORM("cli/scripts/gate-fat-tools.ts"))).toBe("gate-fat-tools");
    expect(hookNameOf(OLD_FORM("cli/scripts/orchestrate-parent.ts"))).toBe("orchestrate-parent");
    expect(hookNameOf(`${OLD_FORM("cli/scripts/worktree.ts")} hook`)).toBe("worktree");
    expect(hookNameOf('bun "$GROK_WORKSPACE_ROOT/cli/scripts/rtk-grok.ts"')).toBe("rtk-grok");
  });

  it("is null for any other command", () => {
    expect(hookNameOf(OLD_FORM("scripts/daily-pull-check.mjs"))).toBeNull();
    expect(hookNameOf('"$d/node_modules/.bin/repo" hook nope')).toBeNull();
    expect(hookNameOf("echo gate-fat-tools.tsx")).toBeNull();
    expect(hookNameOf("bun run worktree.ts.bak")).toBeNull();
  });
});
