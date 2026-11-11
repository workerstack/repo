import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, onTestFinished } from "vitest";
import { fwd } from "../../dev/test-paths.ts";
import {
  HOOK_NAMES,
  HOOK_USAGE,
  expandHookCommand,
  hookCommand,
  hookNameOf,
  isHookName,
  repoBinLookup,
} from "./hook-command.ts";
import { readEnv } from "../env.ts";

/** A temp dir removed when the test ends. */
function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const OLD_FORM = (rel: string) =>
  `d="\${GROK_WORKSPACE_ROOT:-\${CLAUDE_PROJECT_DIR:-.}}"; [ -e "$d/${rel}" ] || d="$(git -C "$d" rev-parse --show-toplevel 2>/dev/null || echo "$d")"; bun "$d/${rel}"`;

/**
 * The text every host has run since hooks went through the bin;
 * generated files and old manifests compare against it.
 */
const WORKTREE_COMMAND =
  'd="${GROK_WORKSPACE_ROOT:-${CLAUDE_PROJECT_DIR:-.}}"; b=node_modules/.bin/repo; [ -e "$d/$b" ] || [ -e "$d/$b.exe" ] || ' +
  'd="$(git -C "$d" rev-parse --show-toplevel 2>/dev/null || echo "$d")"; ' +
  'm="$(git -C "$d" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; m="${m%/*}"; r=; ' +
  'for c in "$d" "$m"; do for e in "" .exe; do [ -n "$c" ] && [ -e "$c/$b$e" ] && { r="$c/$b$e"; break 2; }; done; done; ' +
  '[ -x "$r" ] || { echo "repo: $d/$b is missing; run bun install" >&2; exit 1; }; "$r" hook worktree';

it("hook names: names hooks, and nothing else", () => {
  expect(isHookName("gate-fat-tools")).toBe(true);
  expect(isHookName("nope")).toBe(false);
  expect(isHookName("toString")).toBe(false);
  expect(isHookName(undefined)).toBe(false);
  expect(HOOK_USAGE).toBe(
    "use gate-fat-tools, orchestrate-parent, rtk-grok, scrub-spawn-prompt, session-map or worktree",
  );
});

it("hookCommand: runs the bin in the project dir with the hook's stdin", () => {
  const dir = tempDir("hook-cmd-");
  const bin = path.join(dir, "node_modules", ".bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "repo"), '#!/bin/sh\necho "$@"; cat\n', { mode: 0o755 });
  const r = spawnSync("sh", ["-c", hookCommand("session-map")], {
    env: { PATH: readEnv().PATH, CLAUDE_PROJECT_DIR: dir },
    input: "payload",
    encoding: "utf8",
  });
  expect(r.status).toBe(0);
  expect(r.stdout).toBe("hook session-map\npayload");
});

it("hookCommand: keeps its text as it was", () => {
  expect(hookCommand("worktree")).toBe(WORKTREE_COMMAND);
});

it("hookCommand: runs the repo.exe a Windows install links when there is no plain repo", () => {
  const root = fs.realpathSync(tempDir("hook-cmd-"));
  spawnSync("git", ["init", "-q"], { cwd: root });
  const pkg = path.join(root, "packages", "a");
  fs.mkdirSync(pkg, { recursive: true });
  const bin = path.join(root, "node_modules", ".bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "repo.exe"), '#!/bin/sh\necho "exe $@"\n', { mode: 0o755 });
  for (const env of [{ CLAUDE_PROJECT_DIR: root }, { CLAUDE_PROJECT_DIR: pkg }]) {
    const r = spawnSync("sh", ["-c", hookCommand("session-map")], {
      cwd: pkg,
      env: { PATH: readEnv().PATH, ...env },
      encoding: "utf8",
    });
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe("exe hook session-map\n");
  }
});

it("hookCommand: says run bun install and exits 1 in a checkout with no install", () => {
  const dir = tempDir("hook-cmd-");
  const r = spawnSync("sh", ["-c", hookCommand("gate-fat-tools")], {
    cwd: dir,
    env: { PATH: readEnv().PATH, CLAUDE_PROJECT_DIR: dir },
    encoding: "utf8",
  });
  expect(r.status).toBe(1);
  expect(r.stdout).toBe("");
  expect(r.stderr).toBe(`repo: ${dir}/node_modules/.bin/repo is missing; run bun install\n`);
});

function setup(mainBin: "repo" | "repo.exe" | null, ownBin: "repo" | "repo.exe" | null = null) {
  const base = fs.realpathSync(tempDir("hook-wt-"));
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
    env: { PATH: readEnv().PATH, CLAUDE_PROJECT_DIR: project },
    encoding: "utf8",
  });

it("hookCommand in a linked worktree: runs the main checkout's bin when the worktree has no install", () => {
  const { wt } = setup("repo");
  const r = run(wt, wt);
  expect(r.stderr).toBe("");
  expect(r.stdout).toBe("main hook session-map\n");
  expect(r.status).toBe(0);
});

it("hookCommand in a linked worktree: falls back from a package folder inside the worktree", () => {
  const { wt } = setup("repo");
  const pkg = path.join(wt, "packages", "a");
  fs.mkdirSync(pkg, { recursive: true });
  expect(run(pkg, pkg).stdout).toBe("main hook session-map\n");
});

it("hookCommand in a linked worktree: probes repo.exe at the main checkout", () => {
  const { wt } = setup("repo.exe");
  expect(run(wt, wt).stdout).toBe("main hook session-map\n");
});

it.each(["repo", "repo.exe"] as const)(
  "hookCommand in a linked worktree: prefers the worktree's own %s over the main checkout's",
  (own) => {
    const { wt } = setup("repo", own);
    expect(run(wt, wt).stdout).toBe("own hook session-map\n");
  },
);

it(
  "hookCommand in a linked worktree: from . (a git hook) runs the bin of the checkout git runs it in, " +
    "whatever project the agent env names",
  () => {
    const lookup = (cwd: string, project: string) =>
      spawnSync("sh", ["-c", `${repoBinLookup(".")}; "$r" turn --staged`], {
        cwd,
        env: { PATH: readEnv().PATH, CLAUDE_PROJECT_DIR: project, GROK_WORKSPACE_ROOT: project },
        encoding: "utf8",
      }).stdout;
    const installed = setup("repo", "repo");
    expect(lookup(installed.wt, installed.main)).toBe("own turn --staged\n");
    const bare = setup("repo");
    expect(lookup(bare.wt, bare.base)).toBe("main turn --staged\n");
  },
);

it(
  "hookCommand in a linked worktree: keeps the worktree as the root in the message " +
    "when no checkout has an install",
  () => {
    const { wt } = setup(null);
    const r = run(wt, wt);
    expect(r.status).toBe(1);
    expect(r.stderr).toBe(`repo: ${fwd(wt)}/node_modules/.bin/repo is missing; run bun install\n`);
  },
);

it("expandHookCommand: expands the short form of a known hook and leaves every other command alone", () => {
  expect(expandHookCommand("repo hook worktree")).toBe(hookCommand("worktree"));
  for (const other of ["repo hook nope", "repo hook worktree --x", "bun repo hook worktree", hookCommand("worktree")]) {
    expect(expandHookCommand(other)).toBe(other);
  }
});

it("expandHookCommand: is the only place stock sources get the shell text: they hold the short form", () => {
  const stock = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "agents");
  const files = [
    "hooks.jsonc",
    ...fs.readdirSync(path.join(stock, "grok", "hooks")).map((f) => path.join("grok", "hooks", f)),
  ];
  const commands = files.flatMap((rel) =>
    [...fs.readFileSync(path.join(stock, rel), "utf8").matchAll(/"command":\s*"((?:[^"\\]|\\.)*)"/g)].map(
      (m) => [rel, m[1] ?? ""] as const,
    ),
  );
  expect(commands.length).toBeGreaterThan(10);
  for (const [rel, command] of commands) {
    expect(command, rel).toMatch(/^repo hook [\w-]+$/);
  }
});

it.each(HOOK_NAMES)("hookNameOf: reads %s back from its command", (name) => {
  expect(hookNameOf(hookCommand(name))).toBe(name);
});

it("hookNameOf: reads the old direct script forms", () => {
  expect(hookNameOf(OLD_FORM("cli/scripts/gate-fat-tools.ts"))).toBe("gate-fat-tools");
  expect(hookNameOf(OLD_FORM("cli/scripts/orchestrate-parent.ts"))).toBe("orchestrate-parent");
  expect(hookNameOf(`${OLD_FORM("cli/scripts/worktree.ts")} hook`)).toBe("worktree");
  expect(hookNameOf('bun "$GROK_WORKSPACE_ROOT/cli/scripts/rtk-grok.ts"')).toBe("rtk-grok");
});

it("hookNameOf: is null for any other command", () => {
  expect(hookNameOf(OLD_FORM("scripts/daily-pull-check.mjs"))).toBeNull();
  expect(hookNameOf('"$d/node_modules/.bin/repo" hook nope')).toBeNull();
  expect(hookNameOf("echo gate-fat-tools.tsx")).toBeNull();
  expect(hookNameOf("bun run worktree.ts.bak")).toBeNull();
});
