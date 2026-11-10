import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { CONFIG_FILE } from "./config.ts";
import { runSync } from "./sync.ts";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A temp workspace with the workspace pack and two packages that each have a vitest.config.ts. */
function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-sync-workspace-"));
  temps.push(root);
  const files: Record<string, string> = {
    [CONFIG_FILE]: 'export default { packs: ["workspace"] }\n',
    "package.json": JSON.stringify({ private: true, workspaces: ["packages/*"] }),
    "packages/a/package.json": JSON.stringify({ name: "a" }),
    "packages/a/vitest.config.ts": "export default {};\n",
    "packages/b/package.json": JSON.stringify({ name: "b" }),
    "packages/b/vitest.config.ts": "export default {};\n",
  };
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

it("repo sync under the workspace pack writes the root vitest.config.ts and turbo.json with no errors, then is up to date", async () => {
  const root = workspace();
  const out: string[] = [];
  const err: string[] = [];
  const io = { cwd: root, stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) };
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
