import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOOK_NAMES, HOOK_USAGE, expandHookCommand, hookCommand, hookNameOf, isHookName } from "./hook-command.ts";

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
      const r = spawnSync("sh", ["-c", hookCommand("session-map")], {
        cwd: pkg,
        env: { PATH: process.env.PATH, ...env },
        encoding: "utf8",
      });
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

describe("hookCommand in a linked worktree", () => {
  function setup(mainBin: "repo" | "repo.exe" | null, ownBin: "repo" | "repo.exe" | null = null) {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hook-wt-")));
    const main = path.join(base, "main");
    const wt = path.join(base, "out", "fix-x");
    fs.mkdirSync(main, { recursive: true });
    const git = (cwd: string, ...a: string[]) =>
      spawnSync("git", ["-c", "user.email=a@b", "-c", "user.name=a", ...a], { cwd, encoding: "utf8" });
    git(main, "init", "-q");
    git(main, "commit", "-q", "--allow-empty", "-m", "i");
    git(main, "worktree", "add", "-q", wt);
    const put = (dir: string, bin: string | null, tag: string) => {
      if (!bin) return;
      fs.mkdirSync(path.join(dir, "node_modules", ".bin"), { recursive: true });
      fs.writeFileSync(path.join(dir, "node_modules", ".bin", bin), `#!/bin/sh\necho "${tag} $@"\n`, { mode: 0o755 });
    };
    put(main, mainBin, "main");
    put(wt, ownBin, "own");
    return { base, main, wt };
  }
  const run = (cwd: string, project: string) =>
    spawnSync("sh", ["-c", hookCommand("session-map")], {
      cwd,
      env: { PATH: process.env.PATH, CLAUDE_PROJECT_DIR: project },
      encoding: "utf8",
    });

  it("runs the main checkout's bin when the worktree has no install", () => {
    const { wt } = setup("repo");
    const r = run(wt, wt);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe("main hook session-map\n");
    expect(r.status).toBe(0);
  });

  it("falls back from a package folder inside the worktree", () => {
    const { wt } = setup("repo");
    const pkg = path.join(wt, "packages", "a");
    fs.mkdirSync(pkg, { recursive: true });
    expect(run(pkg, pkg).stdout).toBe("main hook session-map\n");
  });

  it("probes repo.exe at the main checkout", () => {
    const { wt } = setup("repo.exe");
    expect(run(wt, wt).stdout).toBe("main hook session-map\n");
  });

  it.each(["repo", "repo.exe"] as const)("prefers the worktree's own %s over the main checkout's", (own) => {
    const { wt } = setup("repo", own);
    expect(run(wt, wt).stdout).toBe("own hook session-map\n");
  });

  it("keeps the worktree as the root in the message when no checkout has an install", () => {
    const { wt } = setup(null);
    const r = run(wt, wt);
    expect(r.status).toBe(1);
    expect(r.stderr).toBe(`repo: ${wt}/node_modules/.bin/repo is missing; run bun install\n`);
  });
});

describe("expandHookCommand", () => {
  it("expands the short form of a known hook and leaves every other command alone", () => {
    expect(expandHookCommand("repo hook worktree")).toBe(hookCommand("worktree"));
    for (const other of [
      "repo hook nope",
      "repo hook worktree --x",
      "bun repo hook worktree",
      hookCommand("worktree"),
    ]) {
      expect(expandHookCommand(other)).toBe(other);
    }
  });

  it("is the only place stock sources get the shell text: they hold the short form", () => {
    const stock = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "agents");
    const files = [
      "hooks.jsonc",
      ...fs.readdirSync(path.join(stock, "grok", "hooks")).map((f) => path.join("grok", "hooks", f)),
    ];
    const commands = files.flatMap((rel) =>
      [...fs.readFileSync(path.join(stock, rel), "utf8").matchAll(/"command":\s*"((?:[^"\\]|\\.)*)"/g)].map(
        (m) => [rel, m[1]!] as const,
      ),
    );
    expect(commands.length).toBeGreaterThan(10);
    for (const [rel, command] of commands) {
      expect(command, rel).toMatch(/^repo hook [\w-]+$/);
    }
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
