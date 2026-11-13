import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempDirs } from "../cli/__fixtures__/temp-dirs.ts";
import { checkLeftovers, mapText, moveTree, run } from "./move-tmp-paths.ts";

const { tempDir } = useTempDirs("move-tmp-");

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

type Lines = { io: { out: (l: string) => void; err: (l: string) => void }; lines: string[] };

function collect(): Lines {
  const lines: string[] = [];

  return { io: { err: (l) => lines.push(l), out: (l) => lines.push(l) }, lines };
}

type Seeded = { root: string; tree: string };

function seed(): Seeded {
  const root = tempDir();
  const tree = path.join(root, ".tmp", "repo");
  write(
    path.join(tree, "plans", "p.md"),
    `see ${path.join(root, ".tmp", "repo", "plans", "q.md")} and .tmp/repo/sessions/x\n`,
  );
  write(path.join(tree, "sessions", "s.json"), "{}");
  write(path.join(tree, "red-proof-1", "r.txt"), "r");
  write(path.join(tree, "dump.txt"), "d");
  write(path.join(tree, "misc", "n.md"), 'join(".tmp", "repo", "plans")\n');

  return { root, tree };
}

describe("mapText", () => {
  it("maps work dirs, state dirs and the rest", () => {
    expect(mapText("a .tmp/repo/plans/x.md b")).toBe("a .repo/plans/x.md b");
    expect(mapText(".tmp/repo/handoffs")).toBe(".repo/handoffs");
    expect(mapText(".tmp/repo/sessions/a.json")).toBe(".repo/tmp/sessions/a.json");
    expect(mapText(".tmp/repo/stash/1")).toBe(".repo/tmp/stash/1");
    expect(mapText(".tmp/repo/red-proof-abc/x")).toBe(".repo/tmp/red-proof-abc/x");
    expect(mapText("`.tmp/repo/red-proof-${id}/x`")).toBe("`.repo/tmp/red-proof-${id}/x`");
    expect(mapText(".tmp/repo/notes.md")).toBe(".repo/scratch/notes.md");
    expect(mapText("see .tmp/repo/ here")).toBe("see .repo/scratch/ here");
    expect(mapText("see .tmp/repo here")).toBe("see .repo/scratch here");
  });

  it("maps backslash and drive-letter spellings", () => {
    expect(mapText(String.raw`C:\w\.tmp\repo\plans\x.md`)).toBe(String.raw`C:\w\.repo\plans\x.md`);
    expect(mapText(String.raw`C:\w\.tmp\repo\sessions\x`)).toBe(String.raw`C:\w\.repo\tmp\sessions\x`);
    expect(mapText(String.raw`.tmp\repo\other`)).toBe(String.raw`.repo\scratch\other`);
  });

  it("maps segment arrays", () => {
    expect(mapText('join(r, ".tmp", "repo", "plans")')).toBe('join(r, ".repo", "plans")');
    expect(mapText('join(r, ".tmp", "repo", "sessions", "a")')).toBe('join(r, ".repo", "tmp", "sessions", "a")');
    expect(mapText('join(r, ".tmp", "repo")')).toBe('join(r, ".repo", "scratch")');
    expect(mapText("join(r, '.tmp', 'repo', 'x.md')")).toBe("join(r, '.repo', 'scratch', 'x.md')");
  });

  it("leaves other text and is idempotent", () => {
    const text = ".tmp/repository .tmp/other .repo/plans";
    expect(mapText(text)).toBe(text);
    expect(mapText(mapText(".tmp/repo/plans/a"))).toBe(".repo/plans/a");
  });
});

describe("mapText JSON", () => {
  it("maps doubled backslashes as written inside JSON strings", () => {
    expect(mapText(String.raw`{"p":"C:\\r\\.tmp\\repo\\plans\\x.md"}`)).toBe(
      String.raw`{"p":"C:\\r\\.repo\\plans\\x.md"}`,
    );
    expect(mapText(String.raw`C:\\r\\.tmp\\repo\\sessions\\s`)).toBe(String.raw`C:\\r\\.repo\\tmp\\sessions\\s`);
  });
});

describe("checkLeftovers", () => {
  it("lists file:line of each leftover", () => {
    const root = tempDir();
    write(path.join(root, "a.ts"), 'ok\nconst x = ".tmp/repo/plans";\n');
    write(path.join(root, "node_modules", "b.ts"), ".tmp/repo\n");
    write(path.join(root, "CHANGELOG.md"), ".tmp/repo\n");
    write(path.join(root, "c.ts"), 'join(".tmp", "repo")\n');
    write(path.join(root, "dev", "move-tmp-paths.ts"), ".tmp/repo\n");

    expect(checkLeftovers(root, ["."])).toStrictEqual(["a.ts:2", "c.ts:1"]);
  });
});

describe("run", () => {
  it("rewrites files by default and skips fenced dirs", () => {
    const root = tempDir();
    write(path.join(root, "src", "a.ts"), "x .tmp/repo/plans\n");
    write(path.join(root, ".worktrees", "w", "a.ts"), ".tmp/repo/plans\n");
    const { io } = collect();

    expect(run(["src", ".worktrees"], io, root)).toBe(0);
    expect(fs.readFileSync(path.join(root, "src", "a.ts"), "utf8")).toBe("x .repo/plans\n");
    expect(fs.readFileSync(path.join(root, ".worktrees", "w", "a.ts"), "utf8")).toBe(".tmp/repo/plans\n");
  });

  it("--check writes nothing, exits 1 with leftovers and 0 when clean", () => {
    const root = tempDir();
    write(path.join(root, "a.ts"), ".tmp/repo/plans\n");
    const { io, lines } = collect();

    expect(run(["--check", "."], io, root)).toBe(1);
    expect(lines).toStrictEqual(["a.ts:1"]);
    expect(fs.readFileSync(path.join(root, "a.ts"), "utf8")).toBe(".tmp/repo/plans\n");
    run(["."], io, root);
    expect(run(["--check", "."], io, root)).toBe(0);
  });
});

describe("moveTree", () => {
  it("moves entries per the map, rewrites md and removes the source", () => {
    const { root, tree } = seed();
    const { io } = collect();

    expect(moveTree(tree, io)).toBe(0);
    const repo = path.join(root, ".repo");
    expect(fs.existsSync(tree)).toBe(false);
    expect(fs.readFileSync(path.join(repo, "tmp", "sessions", "s.json"), "utf8")).toBe("{}");
    expect(fs.existsSync(path.join(repo, "tmp", "red-proof-1", "r.txt"))).toBe(true);
    expect(fs.existsSync(path.join(repo, "scratch", "dump.txt"))).toBe(true);
    expect(moveTree(tree, io)).toBe(0);
  });

  it("rewrites paths inside moved md files", () => {
    const { root, tree } = seed();
    const repo = path.join(root, ".repo");

    moveTree(tree, collect().io);
    expect(fs.readFileSync(path.join(repo, "plans", "p.md"), "utf8")).toBe(
      `see ${path.join(root, ".repo", "plans", "q.md")} and .repo/tmp/sessions/x\n`,
    );
    expect(fs.readFileSync(path.join(repo, "scratch", "misc", "n.md"), "utf8")).toBe('join(".repo", "plans")\n');
  });
});

describe("moveTree session state", () => {
  it("rewrites every text file, leaves binary files alone and is idempotent", () => {
    const { root, tree } = seed();
    const old = path.join(root, ".tmp", "repo", "plans", "1-a.md");
    const binary = Buffer.from([0x00, 0x01, ...Buffer.from(old)]);
    write(path.join(tree, "sessions", "s1", "approvals.txt"), `${old}\n`);
    write(path.join(tree, "sessions", "s1", "strategy.json"), JSON.stringify({ plan: old }));
    fs.writeFileSync(path.join(tree, "sessions", "s1", "blob.bin"), binary);
    const sessions = path.join(root, ".repo", "tmp", "sessions", "s1");
    const fresh = path.join(root, ".repo", "plans", "1-a.md");

    moveTree(tree, collect().io);
    expect(fs.readFileSync(path.join(sessions, "approvals.txt"), "utf8")).toBe(`${fresh}\n`);
    expect(fs.readFileSync(path.join(sessions, "strategy.json"), "utf8")).toBe(JSON.stringify({ plan: fresh }));
    expect(fs.readFileSync(path.join(sessions, "blob.bin")).equals(binary)).toBe(true);

    const before = fs.readFileSync(path.join(sessions, "approvals.txt"), "utf8");
    const { io, lines } = collect();

    expect(moveTree(tree, io)).toBe(0);
    expect(lines).toStrictEqual([]);
    expect(fs.readFileSync(path.join(sessions, "approvals.txt"), "utf8")).toBe(before);
  });
});

describe("moveTree merge", () => {
  it("merges without overwriting and reports conflicts", () => {
    const { root, tree } = seed();
    write(path.join(root, ".repo", "plans", "p.md"), "mine");
    write(path.join(tree, "plans", "new.md"), "new");
    const { io, lines } = collect();

    expect(moveTree(tree, io)).toBe(0);
    expect(fs.readFileSync(path.join(root, ".repo", "plans", "p.md"), "utf8")).toBe("mine");
    expect(fs.readFileSync(path.join(root, ".repo", "plans", "new.md"), "utf8")).toBe("new");
    expect(lines.some((l) => l.includes("conflict") && l.includes("p.md"))).toBe(true);
    expect(fs.existsSync(path.join(tree, "plans", "p.md"))).toBe(true);
  });

  it("--tree runs through run", () => {
    const { root, tree } = seed();
    const { io } = collect();

    expect(run(["--tree", tree], io, root)).toBe(0);
    expect(fs.existsSync(path.join(root, ".repo", "tmp", "sessions", "s.json"))).toBe(true);
  });
});
