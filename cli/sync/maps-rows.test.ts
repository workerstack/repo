import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { selfWs } from "./fixtures/maps-kit.ts";
import { put, tempDir, useTempDirs } from "./fixtures/temp-dirs.ts";
import { mapSections } from "./maps.ts";

useTempDirs();

const rowOf = (ws: string, file: string) =>
  mapSections(ws)
    .refs.split("\n")
    .find((line) => line.includes(`references/${file} |`));

it("keeps a bare row for huge, binary and unreadable refs, and skips dotfiles and non-markdown", () => {
  const ws = selfWs("maps-huge-");
  put(ws, "references/huge.md", `# Huge\n\n${"x".repeat(512 * 1024 + 1)}`);
  put(ws, "references/bin.md", "# Bin\0\n");
  put(ws, "references/.hidden.md", "# Hidden\n");
  put(ws, "references/notes.txt", "x");
  put(ws, "references/.dir/skipped.md", "# Skipped\n");
  fs.symlinkSync(path.join(ws, "references", "huge.md"), path.join(ws, "references", "link.md"));
  const { refs } = mapSections(ws);
  expect(rowOf(ws, "huge.md")).toBe("| node_modules/@workerstack/repo/references/huge.md | huge |  |  |");
  expect(rowOf(ws, "bin.md")).toBe("| node_modules/@workerstack/repo/references/bin.md | bin |  |  |");
  expect(refs).not.toMatch(/hidden|notes|skipped|link\.md/i);
  expect(refs).not.toMatch(/^x{100,}/m);
});

it("titles a ref from its first heading, falling back to its file name", () => {
  const ws = selfWs("maps-title-");
  put(ws, "references/a.md", "---\ntags: lone\n---\n# Title ##\n\nSummary here.\n");
  put(ws, "references/b.md", "no heading\n");
  put(ws, "references/c.md", "---\ntags: [p, q]\n---\n# C\n");
  put(ws, "references/d.md", '---\ntags: "[r, s]"\n---\n# D\n');
  expect(rowOf(ws, "a.md")).toBe("| node_modules/@workerstack/repo/references/a.md | Title | lone | Summary here. |");
  expect(rowOf(ws, "b.md")).toBe("| node_modules/@workerstack/repo/references/b.md | b |  |  |");
  expect(rowOf(ws, "c.md")).toBe("| node_modules/@workerstack/repo/references/c.md | C | p, q |  |");
  expect(rowOf(ws, "d.md")).toBe("| node_modules/@workerstack/repo/references/d.md | D | r, s |  |");
});

it("is empty for a repo with no references or skills", () => {
  const ws = tempDir("maps-empty-");
  expect(mapSections(ws).refs.split("\n")).toHaveLength(2);
  expect(mapSections(ws).skills.split("\n")).toHaveLength(2);
});
