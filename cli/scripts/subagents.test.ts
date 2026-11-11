import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { byCodeUnit } from "../sync/by-code-unit.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dir = path.join(repoRoot, "agents/subagents");

/** The rules every subagent body carries, word for word. */
const RULES = [
  "Rules:",
  "- Work only in the worktree the brief names.",
  "- Run the CLI as `bun repo …`.",
  "- Route big output through `bun repo job`: `--job test --query '<cmd>'` for tests, " +
    "`--job exec` or `--job search` for anything else that prints a lot. " +
    "Read a stash path only with offset and limit.",
].join("\n");

/** The final lines each subagent ends its return with. */
const RETURNS: Record<string, string> = {
  "implementer-deep":
    "changed: <comma-separated repo-relative paths>\ntests: <last test command> → exit <N>\nstatus: done|partial|stuck",
  "implementer-fast":
    "changed: <comma-separated repo-relative paths>\ntests: <last test command> → exit <N>\nstatus: done|partial|stuck",
  researcher:
    "facts: <one fact per line, each with its source>\nsources: <urls or repo paths>\nstatus: done|partial|stuck",
  scout: "facts: <one fact per line>\nstatus: done|partial|stuck",
};

function body(file: string): string {
  const text = fs.readFileSync(path.join(dir, file), "utf8").replaceAll("\r\n", "\n");
  return text.slice(text.indexOf("\n---\n", 3) + 5);
}

describe("subagent bodies", () => {
  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".md") && file !== "orchestrator.md")
    .toSorted(byCodeUnit);

  it("covers every subagent but the orchestrator, researcher included", () => {
    expect(files).toStrictEqual(["implementer-deep.md", "implementer-fast.md", "researcher.md", "scout.md"]);
  });

  for (const file of files) {
    const name = file.replace(/\.md$/, "");
    it(`${name} holds the rules block and ends in its return block`, () => {
      const text = body(file).trimEnd();
      expect(text).toContain(RULES);
      expect(text.endsWith(String(RETURNS[name]))).toBe(true);
    });
  }
});
