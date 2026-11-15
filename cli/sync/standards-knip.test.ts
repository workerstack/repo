import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { contentOf, context, file } from "./__fixtures__/standards-kit.ts";
import { tempDir, useTempDirs } from "./__fixtures__/temp-dirs.ts";
import { standards } from "./standards.ts";

useTempDirs();

/** A standards context rooted at a new git repo holding `a.config.ts`. */
function gitContext() {
  const root = tempDir("workerstack-standards-knip-");
  execFileSync("git", ["init", "-q"], { cwd: root });
  fs.writeFileSync(path.join(root, "a.config.ts"), "");
  const ctx = context(["standards"]);

  return { ...ctx, root, workspace: { ...ctx.workspace, root } };
}

it("makes a tracked config this sync writes a knip entry before it is on disk, and an untracked one never", () => {
  const ctx = gitContext();
  const planned = [file("vitest.config.ts", { tracked: true }), file("gen.config.ts", { tracked: false })];
  const { outputs } = standards(ctx, planned);

  expect(contentOf(outputs, "knip.jsonc")).toMatchObject({
    workspaces: {
      ".": {
        entry: [
          "{index,cli,main}.{js,mjs,cjs,jsx,ts,tsx,mts,cts}!",
          "src/{index,cli,main}.{js,mjs,cjs,jsx,ts,tsx,mts,cts}!",
          "a.config.ts",
          "vitest.config.ts",
        ],
      },
    },
  });
});
