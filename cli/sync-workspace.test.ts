import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { CONFIG_FILE } from "./config.constants.ts";
import { runSync } from "./sync.ts";
import { put, tempDir, useTempDirs } from "./sync/__fixtures__/temp-dirs.ts";

useTempDirs();

/** A temp workspace with the workspace pack and two packages that each have a vitest.config.ts. */
function workspace(): string {
  const root = tempDir("workerstack-sync-workspace-");

  const files: Record<string, string> = {
    [CONFIG_FILE]: 'export default { packs: ["workspace"] }\n',
    "package.json": JSON.stringify({ private: true, workspaces: ["packages/*"] }),
    "packages/a/package.json": JSON.stringify({ name: "a" }),
    "packages/a/vitest.config.ts": "export default {};\n",
    "packages/b/package.json": JSON.stringify({ name: "b" }),
    "packages/b/vitest.config.ts": "export default {};\n",
  };

  for (const [rel, text] of Object.entries(files)) put(root, rel, text);

  return root;
}

it("sync under the workspace pack writes the root vitest.config.ts and turbo.json, then is up to date", async () => {
  const root = workspace();
  const out: string[] = [];
  const err: string[] = [];
  const io = { cwd: root, stderr: (s: string) => err.push(s), stdout: (s: string) => out.push(s) };
  expect(await runSync([], io)).toBe(0);
  expect(err.join("")).toBe("");
  expect(fs.readFileSync(path.join(root, "vitest.config.ts"), "utf8")).toContain(
    '["packages/a/vitest.config.ts","packages/b/vitest.config.ts"]',
  );
  expect(JSON.parse(fs.readFileSync(path.join(root, "turbo.json"), "utf8"))).toHaveProperty("tasks.test");
  expect(fs.readFileSync(path.join(root, ".gitignore"), "utf8")).toContain(".turbo/");
  out.length = 0;
  expect(await runSync(["--check"], io)).toBe(0);
});
