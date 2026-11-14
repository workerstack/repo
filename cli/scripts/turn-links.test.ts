import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { cleanTemps, consumer, git, SLOW, turn, write } from "./__fixtures__/turn-repo.ts";

afterEach(cleanTemps);

it("--staged gates a .ts file beside a staged symlink to a directory", { timeout: SLOW }, async () => {
  const root = consumer({ "skills/x/SKILL.md": "# X\n", "src/a.ts": "export const a = 1;\n" });
  write(root, { "src/a.ts": "export const a = {b:1}\n" });
  fs.mkdirSync(path.join(root, ".claude/skills"), { recursive: true });
  fs.symlinkSync(path.join("..", "..", "skills", "x"), path.join(root, ".claude/skills/x"), "dir");
  git(root, "add", "src/a.ts", ".claude/skills/x");
  const result = await turn(root, ["--staged"]);
  expect(result.err).toBe("");
  expect(result.out).toMatch(/^turn: 2 files · fmt 1 fixed · comments ok · lint ok · /);
  expect(result.code).toBe(0);
  expect(git(root, "show", ":src/a.ts")).toBe("export const a = { b: 1 };\n");
});

it("a sync run beside an untracked symlink to a directory does not read the link", { timeout: SLOW }, async () => {
  const root = consumer({ "references/a.md": "# A\n", "skills/x/SKILL.md": "# X\n" });
  fs.symlinkSync(path.join("skills", "x"), path.join(root, "link"), "dir");
  fs.rmSync(path.join(root, "references/a.md"));
  const result = await turn(root, []);
  expect(result.err).toBe("");
  expect(result.out).toMatch(/ · sync ok · 0 related tests\n$/);
  expect(result.code).toBe(0);
});
