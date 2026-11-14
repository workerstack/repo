import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { DRAFT_ROADMAP, VALID_PLAN } from "./__fixtures__/persist-bodies.ts";
import { parsePersistCliJson, runPersistCli } from "./__fixtures__/run-persist-cli.ts";
import { run } from "./__fixtures__/run-persist-main.ts";

const { tempDir, track } = useTempDirs("persist-strategy-");

const DENIED =
  "persist: strategy: is set from the session, the roadmap or the config; " +
  "send advice: {free|spawn-fast|spawn-deep} because {reason}";

function tmpDir(): string {
  return fs.realpathSync(tempDir());
}

/** The `strategy:` lines of the file a successful run saved. */
function savedStrategies(r: { code: number; stderr: string; stdout: string }): RegExpMatchArray | null {
  expect(r.code, r.stderr).toBe(0);

  return fs.readFileSync(parsePersistCliJson(r.stdout).absPath, "utf8").match(/^strategy:.*$/gm);
}

describe("repo persist defaults", () => {
  it.each([
    ["plan", VALID_PLAN],
    ["roadmap", DRAFT_ROADMAP],
  ] as const)(
    "saves a %s with the strategy from agents.defaultStrategy in the workspace config",
    async (kind, body) => {
      const ws = tmpDir();
      const config = 'export default { packs: ["agents"], agents: { defaultStrategy: "spawn-fast" } };\n';
      fs.writeFileSync(path.join(ws, "repo.config.ts"), config);
      const r = await run([kind, "--workspace", ws], body);

      expect(savedStrategies(r)).toStrictEqual(["strategy: spawn-fast"]);
    },
  );

  it.each([
    ["plan", VALID_PLAN],
    ["roadmap", DRAFT_ROADMAP],
  ] as const)("saves a %s with strategy free when the workspace has no config", async (kind, body) => {
    const r = await run([kind, "--workspace", tmpDir()], body);

    expect(savedStrategies(r)).toStrictEqual(["strategy: free"]);
  });
});

describe("repo persist spawned strategy", () => {
  it.each([
    ["plan", VALID_PLAN, ".repo/plans"],
    ["roadmap", DRAFT_ROADMAP, ".repo/roadmaps"],
  ] as const)("refuses a %s body with a strategy: line and saves nothing", async (kind, body, dir) => {
    const ws = tmpDir();
    const r = await run([kind, "--workspace", ws], body.replace("\n\n#", "\nstrategy: spawn-deep\n\n#"));
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain(`${DENIED}\n`);
    expect(fs.existsSync(path.join(ws, dir))).toBe(false);
  });

  it("exits 1 with the Usage text for a body with a strategy: line", () => {
    const r = runPersistCli(
      "plan",
      VALID_PLAN.replace("PLAN_NAME: add tmp ignore\n", "PLAN_NAME: add tmp ignore\nstrategy: spawn-deep\n"),
    );

    track(r.cwd);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(DENIED);
  });
});
