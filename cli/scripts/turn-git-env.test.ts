import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { cleanTemps, SLOW, consumer, git, read, tempDir, turn, write } from "./fixtures/turn-repo.ts";
import { childEnv } from "../env.ts";

/**
 * Git hands a hook GIT_DIR, GIT_INDEX_FILE and the like. Turn's own git calls must follow them; the tools it runs
 * must never see them, or a test's `git init` in its own temp dir writes into the repo being committed.
 */
afterEach(() => {
  cleanTemps();
});

/** A related test that records the GIT_* names it sees, then commits in a fresh repo of its own. */
const ENV_TEST = `import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { x } from "./x.ts";

it("commits in its own repo", () => {
  const names = Object.keys(process.env).filter((name) => name.startsWith("GIT_"));
  fs.writeFileSync(process.env.TURN_RECORD as string, JSON.stringify(names));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inner-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "inner"], {
    cwd: dir,
  });
  expect(x).toBe(2);
});
`;

it(
  "runs the tools without the hook's GIT_* variables, so a test's own repo stays its own",
  { timeout: SLOW },
  async () => {
    const root = consumer({ "src/x.ts": "export const x = 1;\n", "src/x.test.ts": ENV_TEST });
    const before = { log: git(root, "log", "--format=%H"), branches: git(root, "branch", "--list") };
    write(root, { "src/x.ts": "export const x = 2;\n" });
    const record = path.join(tempDir("workerstack-turn-env-"), "names.json");
    vi.stubEnv("TURN_RECORD", record);
    vi.stubEnv("GIT_DIR", path.join(root, ".git"));
    vi.stubEnv("GIT_INDEX_FILE", path.join(root, ".git", "index"));
    const result = await turn(root, []);
    expect(result.out).toMatch(/ · 1 related test passed\n$/);
    expect(JSON.parse(fs.readFileSync(record, "utf8"))).toEqual([]);
    vi.unstubAllEnvs();
    expect({ log: git(root, "log", "--format=%H"), branches: git(root, "branch", "--list") }).toEqual(before);
    expect(git(root, "config", "--get", "core.bare")).toBe("false\n");
  },
);

it("--staged reads the index GIT_INDEX_FILE names, as `git commit <paths>` sets it", { timeout: SLOW }, async () => {
  const root = consumer({ "src/a.ts": "export const a = 1;\n" });
  write(root, { "src/b.ts": "export const b = 1;\n" });
  const index = path.join(tempDir("workerstack-turn-index-"), "index");
  const env = childEnv({ GIT_INDEX_FILE: index });
  execFileSync("git", ["read-tree", "HEAD"], { cwd: root, env });
  execFileSync("git", ["add", "src/b.ts"], { cwd: root, env });
  expect((await turn(root, ["--staged"])).out).toBe("turn: no changes\n");
  vi.stubEnv("GIT_INDEX_FILE", index);
  expect((await turn(root, ["--staged"])).out).toMatch(/^turn: 1 file · fmt ok · comments ok · lint ok · /);
  expect(read(root, "src/b.ts")).toBe("export const b = 1;\n");
});
