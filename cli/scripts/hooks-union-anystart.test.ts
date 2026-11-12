import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";
import { z } from "zod";

import { childEnv } from "../env.ts";
import {
  GATE,
  REPO_ROOT,
  expandSource,
  must,
  readJson,
  seedOwnedDrivers,
  ssotOf,
  touchConsumerScripts,
  writeJson,
  type ClaudeDoc,
} from "./__fixtures__/hooks-union-kit.ts";
import { plantDirs } from "./__fixtures__/mcp-policy-kit.ts";
import { HOOK_NAMES, hookCommand } from "./hook-command.ts";
import { rootCmd } from "./hooks-union-commands.ts";
import { allCommands } from "./hooks-union-merge.ts";
import { AUTORUN_NEEDLES } from "./hooks-union.constants.ts";
import { applyUnion, checkUnion } from "./hooks-union.ts";
import { stripJsonc } from "./strip-jsonc.ts";

const tmpDir = plantDirs();
const PROJECT_VARS = ["GROK_WORKSPACE_ROOT", "CLAUDE_PROJECT_DIR"];
const OWNED_STUBS = ["cli/scripts/session-map.ts", "cli/scripts/worktree.ts"];
const STUBS = AUTORUN_NEEDLES.map((n) => `scripts/${n}`);
const RAN = [...HOOK_NAMES.map((n) => `hook ${n}`), ...STUBS];

const EVENTS: Record<string, string> = {
  beforeSubmitPrompt: "UserPromptSubmit",
  preToolUse: "PreToolUse",
  sessionStart: "SessionStart",
  stop: "Stop",
  subagentStop: "SubagentStop",
};

function gitRepo(prefix: string): string {
  const root = fs.realpathSync(tmpDir(prefix));
  spawnSync("git", ["init", "-q"], { cwd: root });

  return root;
}

/** A `node_modules/.bin/repo` stub that records its arguments in `ran`. */
function writeBin(root: string, ran = path.join(root, "ran.txt")): void {
  const bin = path.join(root, "node_modules", ".bin", "repo");
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, `#!/bin/sh\necho "$*" >> ${JSON.stringify(ran)}\n`, { mode: 0o755 });
}

/** A stub that records its root-relative path in `<root>/ran.txt` when run. */
function writeStub(root: string, rel: string, ran = path.join(root, "ran.txt")): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const fsImport = rel.endsWith(".mjs") ? 'import fs from "node:fs";' : 'const fs = require("node:fs");';
  fs.writeFileSync(abs, `${fsImport}\nfs.appendFileSync(${JSON.stringify(ran)}, ${JSON.stringify(`${rel}\n`)});\n`);
}

function run(command: string, cwd: string, extra: Record<string, string> = {}) {
  const env: Record<string, string | undefined> = childEnv({ ...extra });

  for (const k of PROJECT_VARS) if (!(k in extra)) delete env[k];

  return spawnSync("bash", ["-c", command], { cwd, encoding: "utf8", env, input: "{}", timeout: 20_000 });
}

/** The repo's shipped hook sources, plus generated configs shaped like rulesync output of `hooks.jsonc`. */
function seedShipped(root: string): void {
  const ssot = expandSource(fs.readFileSync(path.join(REPO_ROOT, "agents/hooks.jsonc"), "utf8"));
  fs.mkdirSync(path.join(root, "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, "agents/hooks.jsonc"), ssot);

  for (const f of fs.readdirSync(path.join(REPO_ROOT, "agents/grok/hooks"))) {
    const text = expandSource(fs.readFileSync(path.join(REPO_ROOT, "agents/grok/hooks", f), "utf8"));
    writeJson(root, `.grok/hooks/${f}`, JSON.parse(text));
  }

  const hooks: Record<string, unknown[]> = {};

  for (const [event, entries] of Object.entries(ssotOf(ssot).hooks)) {
    hooks[must(EVENTS[event])] = entries.map((e) => ({
      ...(e.matcher === undefined || e.matcher === "" ? {} : { matcher: e.matcher }),
      hooks: [{ command: e.command, timeout: e.timeout, type: "command" }],
    }));
  }

  writeJson(root, ".claude/settings.json", { hooks, permissions: { deny: [] } });
  writeJson(root, ".codex/hooks.json", { hooks });
  writeJson(root, ".agents/hooks.json", { rulesync: { PreToolUse: hooks.PreToolUse, Stop: hooks.Stop } });
  writeJson(root, ".cursor/hooks.json", { hooks: ssotOf(ssot).hooks, version: 1 });
}

function shippedFiles(root: string) {
  return [
    ".claude/settings.json",
    ".codex/hooks.json",
    ".agents/hooks.json",
    ".cursor/hooks.json",
    ...fs
      .readdirSync(path.join(root, ".grok/hooks"))
      .filter((n) => n.endsWith(".json"))
      .map((n) => `.grok/hooks/${n}`),
  ];
}

/** Every command in the generated hook files and the stock source under `root`. */
function commandsOf(root: string): Set<string> {
  const hooksSource = fs.readFileSync(path.join(root, "agents/hooks.jsonc"), "utf8");

  return new Set([
    ...shippedFiles(root).flatMap((f) => allCommands(readJson(root, f))),
    ...allCommands(z.json().parse(JSON.parse(stripJsonc(hooksSource)))),
  ]);
}

it("every shipped and generated command runs its root bin or script from a subdir", () => {
  const root = gitRepo("union-anystart-");
  fs.mkdirSync(path.join(root, "packages/a"), { recursive: true });

  for (const rel of [...STUBS, ...OWNED_STUBS]) writeStub(root, rel);
  writeBin(root);
  seedShipped(root);
  expect(applyUnion({ workspaceRoot: root }).ok).toBe(true);
  const commands = commandsOf(root);

  const extras: Record<string, string>[] = [
    {},
    { CLAUDE_PROJECT_DIR: path.join(root, "packages/a") },
    { CLAUDE_PROJECT_DIR: root },
  ];

  for (const extra of extras) {
    fs.rmSync(path.join(root, "ran.txt"), { force: true });

    for (const c of commands) {
      const r = run(c, path.join(root, "packages/a"), extra);
      expect(r.status, `${JSON.stringify(extra)} ${c}\n${r.stderr}`).toBe(0);
    }

    const ran = new Set(fs.readFileSync(path.join(root, "ran.txt"), "utf8").split("\n").filter(Boolean));
    expect([...ran].toSorted()).toStrictEqual(RAN.toSorted());
  }
}, 30_000);

it("keeps a repo install in a subpackage on its own bin", () => {
  const root = gitRepo("union-subpkg-");
  const web = path.join(root, "apps/web");
  fs.mkdirSync(path.join(web, "src"), { recursive: true });
  writeBin(root, path.join(root, "root-ran.txt"));
  writeBin(web, path.join(root, "ran.txt"));
  const r = run(hookCommand(GATE), path.join(web, "src"), { CLAUDE_PROJECT_DIR: web });
  expect(r.status, r.stderr).toBe(0);
  expect(fs.readFileSync(path.join(root, "ran.txt"), "utf8")).toBe(`hook ${GATE}\n`);
  expect(fs.existsSync(path.join(root, "root-ran.txt"))).toBe(false);
});

it("runs from the hook cwd outside a git repo", () => {
  const dir = fs.realpathSync(tmpDir("union-nogit-"));
  writeStub(dir, "x.mjs");
  const r = run(rootCmd("x.mjs"), dir);
  expect(r.status, r.stderr).toBe(0);
  expect(fs.readFileSync(path.join(dir, "ran.txt"), "utf8")).toBe("x.mjs\n");
});

it("--check names each command that does not find its script from the repo root", () => {
  const ws = tmpDir("union-stale-");
  seedOwnedDrivers(ws);
  seedShipped(ws);
  touchConsumerScripts(ws);
  expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
  const claude = readJson<ClaudeDoc>(ws, ".claude/settings.json");
  must(claude.hooks.PostToolUse).push(
    { hooks: [{ command: "node scripts/validate.mjs --hook", type: "command" }], matcher: "Write" },
    { hooks: [{ command: "node scripts/my-custom-hook.mjs", type: "command" }], matcher: "Write" },
  );
  writeJson(ws, ".claude/settings.json", claude);
  const rtk = 'bun "$GROK_WORKSPACE_ROOT/cli/scripts/rtk-grok.ts"';
  writeJson(ws, ".grok/hooks/rtk.json", {
    hooks: { PreToolUse: [{ hooks: [{ command: rtk, type: "command" }], matcher: "Bash" }] },
  });
  const failures = checkUnion({ workspaceRoot: ws });
  expect(failures).toContain(
    "claude: validate.mjs hook command does not find its script from the repo root: run bun repo sync",
  );
  expect(failures).toContain(
    "grok: rtk-grok hook command is not the one bun repo sync writes for rtk-grok: run bun repo sync",
  );
  expect(failures.filter((f) => f.includes("my-custom-hook"))).toStrictEqual([]);
});
