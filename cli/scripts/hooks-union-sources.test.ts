import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import {
  EDIT_PLATFORM,
  GATE,
  PARENT,
  REPO_ROOT,
  must,
  readJson,
  repoSsot,
  seedOwnedDrivers,
  shipStub,
  writeJson,
  type ClaudeDoc,
} from "./fixtures/hooks-union-kit.ts";
import { plantDirs } from "./fixtures/mcp-policy-kit.ts";
import { TOOLS, eventKey } from "./gate-harness.ts";
import { hookCommand } from "./hook-command.ts";
import { applyUnion, checkUnion } from "./hooks-union.ts";

const tmpDir = plantDirs();
const WORKTREE = hookCommand("worktree");
const group = [{ hooks: [{ command: WORKTREE, timeout: 60, type: "command" }] }];

function matcherFor(name: string): Set<string> {
  const entry = must(repoSsot().hooks.preToolUse?.find((e) => e.command.endsWith(` hook ${name}`)));
  return new Set(must(entry.matcher).split("|").map(eventKey));
}
const specs = Object.values(TOOLS).flatMap((m) => [...m]);

it("routes every tool the gate answers to the gate", () => {
  const gate = matcherFor(GATE);
  expect(specs.map(([key]) => key).filter((key) => !gate.has(key))).toStrictEqual([]);
});

it("routes every shell tool and every persist-owned write to orchestrate-parent", () => {
  const parent = matcherFor(PARENT);
  const owned = specs.filter(
    ([, spec]) => spec.kind === "bash" || (spec.kind === "write" && spec.persistShared === true),
  );
  expect(owned.map(([key]) => key).filter((key) => !parent.has(key))).toStrictEqual([]);
});

it("hooks.jsonc routes Claude's WorktreeCreate and WorktreeRemove, no other harness's, to the worktree hook", () => {
  const sot = repoSsot();
  const entry = [{ command: WORKTREE, timeout: 60, type: "command" }];
  expect(sot.claudecode.hooks).toStrictEqual({ worktreeCreate: entry, worktreeRemove: entry });
  expect(JSON.stringify(sot.hooks)).not.toContain("hook worktree");
  const claude = readJson<ClaudeDoc>(REPO_ROOT, ".claude/settings.json");
  expect(claude.hooks.WorktreeCreate).toStrictEqual(group);
  expect(claude.hooks.WorktreeRemove).toStrictEqual(group);
  for (const rel of [".codex/hooks.json", ".agents/hooks.json"])
    expect(JSON.stringify(readJson(REPO_ROOT, rel)), rel).not.toContain("hook worktree");
});

it("--check needs Claude's worktree hooks only when worktree.ts ships", () => {
  const ws = tmpDir("union-wt-");
  seedOwnedDrivers(ws);
  applyUnion({ workspaceRoot: ws });
  expect(checkUnion({ workspaceRoot: ws })).toStrictEqual([]);
  shipStub(ws, "worktree.ts");
  expect(checkUnion({ workspaceRoot: ws })).toContain("claude: missing worktree");
  const claude = readJson<ClaudeDoc>(ws, ".claude/settings.json");
  claude.hooks.WorktreeCreate = group;
  claude.hooks.WorktreeRemove = group;
  writeJson(ws, ".claude/settings.json", claude);
  applyUnion({ workspaceRoot: ws });
  expect(readJson<ClaudeDoc>(ws, ".claude/settings.json").hooks.WorktreeCreate).toStrictEqual(group);
  expect(checkUnion({ workspaceRoot: ws })).toStrictEqual([]);
});

it("ships() probes <sourceRoot>/cli/scripts", () => {
  const stock = tmpDir("union-stock-");
  const out = tmpDir("union-out-");
  seedOwnedDrivers(out);
  shipStub(stock, "session-map.ts");
  expect(checkUnion({ sourceRoot: stock, workspaceRoot: out })).toContain("claude: missing session-map");
  expect(checkUnion({ workspaceRoot: out })).not.toContain("claude: missing session-map");
  expect(applyUnion({ sourceRoot: stock, workspaceRoot: out }).ok).toBe(true);
  expect(fs.readFileSync(path.join(out, ".claude/settings.json"), "utf8")).toContain("session-map");
  expect(checkUnion({ sourceRoot: stock, workspaceRoot: out })).toStrictEqual([]);
  expect(fs.readdirSync(stock)).toStrictEqual(["cli"]);
});

it(
  "puts a consumer's scripts hook and .repo/permissions.json deny into the hook files under workspaceRoot, " +
    "and checks its git hooks",
  () => {
    const [stock, consumer, out] = [tmpDir("union-stock-"), tmpDir("union-consumer-"), tmpDir("union-out-")];
    seedOwnedDrivers(out);
    fs.mkdirSync(path.join(consumer, "scripts/git-hooks"), { recursive: true });
    fs.writeFileSync(path.join(consumer, "scripts/check-behind.mjs"), "");
    fs.writeFileSync(path.join(consumer, "scripts/git-hooks/pre-commit"), "");
    writeJson(consumer, ".repo/permissions.json", { deny: [EDIT_PLATFORM] });
    writeJson(consumer, ".rulesync/permissions.json", { deny: ["Edit(ignored/**)"] });
    const roots = { consumerRoot: consumer, sourceRoot: stock, workspaceRoot: out };
    expect(applyUnion(roots).ok).toBe(true);
    const text = fs.readFileSync(path.join(out, ".claude/settings.json"), "utf8");
    expect(text).toContain("check-behind.mjs");
    expect(text).toContain(EDIT_PLATFORM);
    expect(text).not.toContain("ignored/**");
    expect(checkUnion(roots)).toStrictEqual([
      "git-hook missing: scripts/git-hooks/pre-commit.mjs",
      "git-hook missing: scripts/git-hooks/pre-push",
      "git-hook missing: scripts/git-hooks/pre-push.mjs",
    ]);
    expect(fs.existsSync(path.join(consumer, ".claude"))).toBe(false);
    expect(fs.existsSync(path.join(stock, ".claude"))).toBe(false);
  },
);
