import { expect, it, vi } from "vitest";

import { runSync } from "../sync.ts";
import { STOP, tracked } from "./fixtures/adoption-kit.ts";
import { plain, read, snapshot, sync, write } from "./fixtures/copied-install.ts";
import { fileOutput } from "./fixtures/mini-install.ts";
import { useTempDirs } from "./fixtures/temp-dirs.ts";

useTempDirs();
vi.setConfig({ testTimeout: 120_000 });

/** A .claude/settings.json with a key of the user's own, which adoption moves to the overlay. */
const MINE = { ".claude/settings.json": JSON.stringify({ permissions: { allow: ["Bash(make lint:*)"] } }) };

/** Plans a generated .claude/settings.json until the adoption wrote its overlay, then fails saying so. */
function generator(ctx: { read: (rel: string) => string | null }) {
  return ctx.read(".repo/settings/claude.json") === null
    ? { errors: [], outputs: [fileOutput(".claude/settings.json", "{}\n")] }
    : { errors: ["generator saw the adopted overlay"], outputs: [] };
}

it("stops, changing nothing, on a file sync would overwrite with other text", async () => {
  const root = plain({});
  write(root, ".claude/agents/scout.md", "my own scout\n");
  const before = snapshot(root);
  const result = await sync(root, [], true);
  expect(result.code).toBe(1);
  expect(result.err).toStrictEqual([STOP(".claude/agents/scout.md")]);
  expect(snapshot(root)).toStrictEqual(before);
});

it("stops on a tracked file under a host dir that it cannot adopt, one line per file, and only those", async () => {
  const root = plain({
    ".claude/commands/a.md": "a\n",
    ".claude/commands/b.md": "b\n",
    ".cursor/rules/x.mdc": "x\n",
  });
  write(root, ".claude/commands/untracked.md", "u\n");
  const before = snapshot(root);
  const result = await sync(root, [], true);
  expect(result.code).toBe(1);
  expect(result.err).toStrictEqual([
    STOP(".claude/commands/a.md"),
    STOP(".claude/commands/b.md"),
    STOP(".cursor/rules/x.mdc"),
  ]);
  expect(snapshot(root)).toStrictEqual(before);
  expect(tracked(root)).toContain(".claude/commands/a.md");
});

it("leaves an untracked file it does not generate alone", async () => {
  const root = plain({});
  write(root, ".claude/settings.local.json", "{}\n");
  const result = await sync(root, [], true);
  expect(result.code).toBe(0);
  expect(read(root, ".claude/settings.local.json")).toBe("{}\n");
});

it("reports a stop as exit 0 under --postinstall", async () => {
  const root = plain({ ".claude/commands/a.md": "a\n" });
  const result = await sync(root, ["--postinstall"], true);
  expect(result.code).toBe(0);
  expect(result.err).toStrictEqual([STOP(".claude/commands/a.md")]);
});

it("--check prints the pending count, exits 1 and writes nothing", async () => {
  const root = plain(MINE);
  const before = snapshot(root);
  const result = await sync(root, ["--check"], true);
  expect(result.code).toBe(1);
  expect(result.err).toStrictEqual(["repo sync: 2 adoption steps pending; run `bun repo sync`\n"]);
  expect(snapshot(root)).toStrictEqual(before);
  const one = plain(MINE, { git: false });
  const oneResult = await sync(one, ["--check"], true);
  expect(oneResult.err).toStrictEqual(["repo sync: 1 adoption step pending; run `bun repo sync`\n"]);
});

it("adopts outside git and does not untrack", async () => {
  const root = plain(MINE, { git: false });
  const result = await sync(root, [], true);
  expect(result.code).toBe(0);
  expect(result.out.join("")).not.toContain("untracked");
  expect(read(root, ".repo/settings/claude.json")).toContain("make lint");
});

it("stops on a real file where a skill link belongs", async () => {
  const root = plain({});
  write(root, ".claude/skills/ask", "not a skill dir\n");
  const result = await sync(root, [], true);
  expect(result.code).toBe(1);
  expect(result.err).toStrictEqual([STOP(".claude/skills/ask")]);
});

it("reports a move that fails while it runs, and a generator error the adoption causes", async () => {
  const both = plain({
    ".agents/skills/x/SKILL.md": "---\nname: x\n---\none\n",
    ".claude/skills/x/SKILL.md": "---\nname: x\n---\ntwo\n",
  });
  const clashed = await sync(both, [], true);
  expect(clashed.code).toBe(1);
  expect(clashed.err.join("")).toContain("already exists and differs");

  const root = plain(MINE, { git: false });
  const out: string[] = [];
  const err: string[] = [];
  const code = await runSync(
    [],
    { cwd: root, stderr: (s) => err.push(s), stdout: (s) => out.push(s) },
    { generators: [generator] },
  );
  expect(code).toBe(1);
  expect(err).toStrictEqual(["repo sync: generator saw the adopted overlay\n", "repo sync: nothing written\n"]);
  expect(read(root, ".repo/settings/claude.json")).toContain("make lint");
});
