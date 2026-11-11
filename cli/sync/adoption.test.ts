import fs from "node:fs";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { SELF_ROOT, exists, plain, read, readJson, snapshot, sync, write } from "./fixtures/copied-install.ts";
import { RULE, STOP, tracked } from "./fixtures/adoption-kit.ts";
import { useTempDirs } from "./fixtures/temp-dirs.ts";

useTempDirs();
vi.setConfig({ testTimeout: 120_000 });

it("moves no hand-written AGENTS.md text into .repo/rules", async () => {
  const root = plain({ "AGENTS.md": RULE });
  const result = await sync(root, [], true);
  expect(result.err).toStrictEqual([]);
  expect(result.code).toBe(0);
  expect(result.out.join("")).not.toContain("adopted");
  expect(exists(root, ".repo/rules/agents.md")).toBe(false);
});

it("adopts nothing a previous sync wrote: an edited generated file is overwritten, not adopted", async () => {
  const root = plain({});
  expect((await sync(root, [], true)).code).toBe(0);
  write(root, ".codex/config.toml", `${read(root, ".codex/config.toml")}\n# stray edit\n`);
  expect((await sync(root, [], true)).code).toBe(0);
  expect(exists(root, ".repo/rules/agents.md")).toBe(false);
  expect(read(root, ".codex/config.toml")).not.toContain("stray edit");
});

it("adopts nothing that equals what sync would generate, even with the manifest gone", async () => {
  const root = plain({});
  expect((await sync(root, [], true)).code).toBe(0);
  fs.rmSync(path.join(root, ".repo", "tmp", "sync.json"));
  const result = await sync(root, [], true);
  expect(result.code).toBe(0);
  expect(result.out.join("")).not.toContain("adopted");
  expect(exists(root, ".repo/rules")).toBe(false);
});

it("takes the keys and hooks of a .claude/settings.json it does not generate into .repo/settings/claude.json", async () => {
  const mine = {
    permissions: { allow: ["Bash(make lint:*)"] },
    hooks: { PostToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "make post-write" }] }] },
  };
  const root = plain({ ".claude/settings.json": JSON.stringify(mine) });
  const result = await sync(root, [], true);
  expect(result.err).toStrictEqual([]);
  expect(result.out).toContain(
    "repo sync: moved your .claude/settings.json keys permissions.allow to .repo/settings/claude.json\n",
  );
  expect(readJson<unknown>(root, ".repo/settings/claude.json")).toStrictEqual(mine);
  const settings = readJson<{ permissions: { allow: string[] } }>(root, ".claude/settings.json");
  expect(settings.permissions.allow).toContain("Bash(make lint:*)");
  expect(read(root, ".claude/settings.json")).toContain("make post-write");
  expect(tracked(root).filter((rel) => rel.startsWith(".claude/"))).toStrictEqual([]);
});

it.each(["{", "[]"])(
  "stops on a .claude/settings.json that is not a JSON object, changing nothing: %s",
  async (text) => {
    const root = plain({ ".claude/settings.json": text });
    const before = snapshot(root);
    const result = await sync(root, [], true);
    expect(result.code).toBe(1);
    expect(result.err).toStrictEqual([STOP(".claude/settings.json")]);
    expect(snapshot(root)).toStrictEqual(before);
  },
);

it.each([
  ["{", "not valid JSON at line 1"],
  ["[]", "not a JSON object"],
])("fails on a .mcp.json holding %s, named, writing nothing", async (text, problem) => {
  const root = plain({ ".mcp.json": text });
  const before = snapshot(root);
  const result = await sync(root, [], true);
  expect(result.code).toBe(1);
  expect(result.err).toStrictEqual([
    `repo sync: mcp policy: .mcp.json: ${problem}; fix it, nothing written\n`,
    "repo sync: nothing written\n",
  ]);
  expect(snapshot(root)).toStrictEqual(before);
});

it("leaves a .mcp.json of the user's own as it is and tracked, with no .repo/mcp.json", async () => {
  const mcp = JSON.stringify({ mcpServers: { docs: { command: "npx", args: ["-y", "docs-mcp"] } } });
  const root = plain({ ".mcp.json": mcp });
  const result = await sync(root, [], true);
  expect(result.err).toStrictEqual([]);
  expect(read(root, ".mcp.json")).toBe(mcp);
  expect(exists(root, ".repo/mcp.json")).toBe(false);
  expect(tracked(root)).toContain(".mcp.json");
});

it("moves a real skill dir under .agents/skills or .claude/skills to .repo/skills and links it", async () => {
  const root = plain({
    ".claude/skills/deploy/SKILL.md": "---\nname: deploy\ndescription: ship\n---\nShip it.\n",
    ".agents/skills/lint/SKILL.md": "---\nname: lint\ndescription: lint\n---\nLint it.\n",
  });
  const result = await sync(root, [], true);
  expect(result.err).toStrictEqual([]);
  expect(result.out).toContain("repo sync: moved .claude/skills/deploy to .repo/skills/deploy\n");
  expect(result.out).toContain("repo sync: moved .agents/skills/lint to .repo/skills/lint\n");
  expect(read(root, ".repo/skills/deploy/SKILL.md")).toContain("Ship it.");
  expect(fs.lstatSync(path.join(root, ".claude/skills/deploy")).isSymbolicLink()).toBe(true);
  expect(fs.lstatSync(path.join(root, ".agents/skills/lint")).isSymbolicLink()).toBe(true);
  expect(tracked(root).filter((rel) => rel.startsWith(".claude/") || rel.startsWith(".agents/"))).toStrictEqual([]);
});

it("leaves a real skill dir that is an unedited stock copy to be replaced by its link", async () => {
  const root = plain({});
  fs.cpSync(path.join(SELF_ROOT, ".agents", "skills", "ask"), path.join(root, ".claude", "skills", "ask"), {
    recursive: true,
  });
  const result = await sync(root, [], true);
  expect(result.code).toBe(0);
  expect(exists(root, ".repo/skills")).toBe(false);
  expect(fs.lstatSync(path.join(root, ".claude/skills/ask")).isSymbolicLink()).toBe(true);
});
