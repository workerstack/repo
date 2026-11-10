import fs from "node:fs";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { SELF_ROOT, exists, plain, read, readJson, snapshot, sync, write } from "./fixtures/copied-install.ts";
import { RULE, STOP, tracked } from "./fixtures/adoption-kit.ts";
import { useTempDirs } from "./fixtures/temp-dirs.ts";

useTempDirs();
vi.setConfig({ testTimeout: 120_000 });

const NOT_OBJECTS = [".claude/settings.json", ".mcp.json"].flatMap((rel) => [
  [rel, "{"],
  [rel, "[]"],
]);

it("takes a hand-written tracked AGENTS.md into .repo/rules/agents.md, the generated AGENTS.md and out of the index", async () => {
  const root = plain({ "AGENTS.md": RULE });
  const result = await sync(root, [], true);
  expect(result.err).toEqual([]);
  expect(result.code).toBe(0);
  expect(result.out).toContain("repo sync: adopted your AGENTS.md as .repo/rules/agents.md\n");
  expect(result.out).toContain("repo sync: untracked AGENTS.md (now generated); commit the result\n");
  expect(read(root, ".repo/rules/agents.md")).toBe(
    `---\ndescription: Carried over from your earlier setup\n---\n${RULE.trim()}\n`,
  );
  expect(read(root, "AGENTS.md")).toContain("Always run the linter.");
  expect(tracked(root)).not.toContain("AGENTS.md");
});

it("adopts nothing a previous sync wrote: an edited generated file is overwritten, not adopted", async () => {
  const root = plain({});
  expect((await sync(root, [], true)).code).toBe(0);
  write(root, "AGENTS.md", `${read(root, "AGENTS.md")}\nstray edit\n`);
  expect((await sync(root, [], true)).code).toBe(0);
  expect(exists(root, ".repo/rules/agents.md")).toBe(false);
  expect(read(root, "AGENTS.md")).not.toContain("stray edit");
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
  expect(result.err).toEqual([]);
  expect(result.out).toContain(
    "repo sync: moved your .claude/settings.json keys permissions.allow to .repo/settings/claude.json\n",
  );
  expect(readJson<unknown>(root, ".repo/settings/claude.json")).toEqual(mine);
  const settings = readJson<{ permissions: { allow: string[] } }>(root, ".claude/settings.json");
  expect(settings.permissions.allow).toContain("Bash(make lint:*)");
  expect(read(root, ".claude/settings.json")).toContain("make post-write");
  expect(tracked(root).filter((rel) => rel.startsWith(".claude/"))).toEqual([]);
});

it.each(NOT_OBJECTS)(
  "stops on a .claude/settings.json or .mcp.json that is not a JSON object, changing nothing: %s holding %s",
  async (rel, text) => {
    const root = plain({ [rel]: text });
    const before = snapshot(root);
    const result = await sync(root, [], true);
    expect(result.code).toBe(1);
    expect(result.err).toEqual([STOP(rel)]);
    expect(snapshot(root)).toEqual(before);
  },
);

it("takes the servers of a .mcp.json it does not generate into .repo/mcp.json, merged back into the generated one", async () => {
  const server = { command: "npx", args: ["-y", "docs-mcp"] };
  const root = plain({ ".mcp.json": JSON.stringify({ mcpServers: { docs: server } }) });
  const result = await sync(root, [], true);
  expect(result.err).toEqual([]);
  expect(result.out).toContain("repo sync: moved your .mcp.json keys mcpServers.docs to .repo/mcp.json\n");
  expect(readJson<unknown>(root, ".repo/mcp.json")).toEqual({ mcpServers: { docs: server } });
  expect(readJson<{ mcpServers: Record<string, unknown> }>(root, ".mcp.json").mcpServers.docs).toEqual(server);
  expect(tracked(root)).not.toContain(".mcp.json");
});

it("moves a real skill dir under .agents/skills or .claude/skills to .repo/skills and links it", async () => {
  const root = plain({
    ".claude/skills/deploy/SKILL.md": "---\nname: deploy\ndescription: ship\n---\nShip it.\n",
    ".agents/skills/lint/SKILL.md": "---\nname: lint\ndescription: lint\n---\nLint it.\n",
  });
  const result = await sync(root, [], true);
  expect(result.err).toEqual([]);
  expect(result.out).toContain("repo sync: moved .claude/skills/deploy to .repo/skills/deploy\n");
  expect(result.out).toContain("repo sync: moved .agents/skills/lint to .repo/skills/lint\n");
  expect(read(root, ".repo/skills/deploy/SKILL.md")).toContain("Ship it.");
  expect(fs.lstatSync(path.join(root, ".claude/skills/deploy")).isSymbolicLink()).toBe(true);
  expect(fs.lstatSync(path.join(root, ".agents/skills/lint")).isSymbolicLink()).toBe(true);
  expect(tracked(root).filter((rel) => rel.startsWith(".claude/") || rel.startsWith(".agents/"))).toEqual([]);
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
