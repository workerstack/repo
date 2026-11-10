import { expect, it, vi } from "vitest";
import { runSync } from "../sync.ts";
import { fileOutput } from "./fixtures/mini-install.ts";
import { plain, read, snapshot, sync, write } from "./fixtures/copied-install.ts";
import { RULE, STOP, tracked } from "./fixtures/adoption-kit.ts";
import { useTempDirs } from "./fixtures/temp-dirs.ts";

useTempDirs();
vi.setConfig({ testTimeout: 120_000 });

/** Plans a generated AGENTS.md until the adoption wrote its rule, then fails saying so. */
const generator = (ctx: { read: (rel: string) => string | null }) =>
  ctx.read(".repo/rules/agents.md") === null
    ? { outputs: [fileOutput("AGENTS.md", "generated\n")], errors: [] }
    : { outputs: [], errors: ["generator saw the adopted rule"] };

it("stops, changing nothing, on a file sync would overwrite with other text", async () => {
  const root = plain({});
  write(root, ".claude/agents/scout.md", "my own scout\n");
  const before = snapshot(root);
  const result = await sync(root, [], true);
  expect(result.code).toBe(1);
  expect(result.err).toEqual([STOP(".claude/agents/scout.md")]);
  expect(snapshot(root)).toEqual(before);
});

it("stops on a tracked file under a host dir that it cannot adopt, one line per file, and only those", async () => {
  const root = plain({
    ".claude/commands/b.md": "b\n",
    ".claude/commands/a.md": "a\n",
    ".cursor/rules/x.mdc": "x\n",
  });
  write(root, ".claude/commands/untracked.md", "u\n");
  const before = snapshot(root);
  const result = await sync(root, [], true);
  expect(result.code).toBe(1);
  expect(result.err).toEqual([
    STOP(".claude/commands/a.md"),
    STOP(".claude/commands/b.md"),
    STOP(".cursor/rules/x.mdc"),
  ]);
  expect(snapshot(root)).toEqual(before);
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
  expect(result.err).toEqual([STOP(".claude/commands/a.md")]);
});

it("--check prints the pending count, exits 1 and writes nothing", async () => {
  const root = plain({ "AGENTS.md": RULE });
  const before = snapshot(root);
  const result = await sync(root, ["--check"], true);
  expect(result.code).toBe(1);
  expect(result.err).toEqual(["repo sync: 2 adoption steps pending; run `bun repo sync`\n"]);
  expect(snapshot(root)).toEqual(before);
  const one = plain({ "AGENTS.md": RULE }, { git: false });
  expect((await sync(one, ["--check"], true)).err).toEqual([
    "repo sync: 1 adoption step pending; run `bun repo sync`\n",
  ]);
});

it("stops when .repo/rules/agents.md already holds other text", async () => {
  const root = plain({
    "AGENTS.md": RULE,
    ".repo/rules/agents.md": "---\ndescription: Carried over from your earlier setup\n---\nother\n",
  });
  const before = snapshot(root);
  const result = await sync(root, [], true);
  expect(result.code).toBe(1);
  expect(result.err).toEqual([
    "repo sync: cannot move AGENTS.md: .repo/rules/agents.md already exists and differs; merge them by hand, then run `bun repo sync`\n",
  ]);
  expect(snapshot(root)).toEqual(before);
});

it("adopts outside git and does not untrack", async () => {
  const root = plain({ "AGENTS.md": RULE }, { git: false });
  const result = await sync(root, [], true);
  expect(result.code).toBe(0);
  expect(result.out.join("")).not.toContain("untracked");
  expect(read(root, ".repo/rules/agents.md")).toContain("Always run the linter.");
});

it("stops on a real file where a skill link belongs", async () => {
  const root = plain({});
  write(root, ".claude/skills/ask", "not a skill dir\n");
  const result = await sync(root, [], true);
  expect(result.code).toBe(1);
  expect(result.err).toEqual([STOP(".claude/skills/ask")]);
});

it("reports a move that fails while it runs, and a generator error the adoption causes", async () => {
  const both = plain({
    ".agents/skills/x/SKILL.md": "---\nname: x\n---\none\n",
    ".claude/skills/x/SKILL.md": "---\nname: x\n---\ntwo\n",
  });
  const clashed = await sync(both, [], true);
  expect(clashed.code).toBe(1);
  expect(clashed.err.join("")).toContain("already exists and differs");

  const root = plain({ "AGENTS.md": RULE }, { git: false });
  const out: string[] = [];
  const err: string[] = [];
  const code = await runSync(
    [],
    { cwd: root, stdout: (s) => out.push(s), stderr: (s) => err.push(s) },
    { generators: [generator] },
  );
  expect(code).toBe(1);
  expect(err).toEqual(["repo sync: generator saw the adopted rule\n", "repo sync: nothing written\n"]);
  expect(read(root, ".repo/rules/agents.md")).toContain("Always run the linter.");
});
