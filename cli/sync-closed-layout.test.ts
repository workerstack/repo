import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it, vi } from "vitest";

import { syncWith, tempDir, useSyncKit, write } from "./__fixtures__/sync-kit.ts";
import { CONFIG_FILE } from "./config.constants.ts";

useSyncKit();
vi.setConfig({ testTimeout: 120_000 });

const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED =
  "rules/, subagents/, skills/, lessons/, tmp/, global-settings/, bench/ (read by repo bench), " +
  "settings/claude.json, hooks.jsonc, " +
  "mcp-policy.jsonc, permissions.json, map.jsonc, lint-baseline.json (read by repo turn and repo check)" +
  ", test-times.json (read by the vitest shard sequencer written by `bun repo ci times`)";
const MODULES_DIR = ["node", "modules"].join("_");
const GIT_DIR = ["", "git"].join(".");
const LINES = [
  `.repo/notes.md: not part of .repo; allowed: ${ALLOWED}; explanations go in references/`,
  ".repo/scripts/: nothing reads it; move what you need out of .repo and delete it",
  '.repo/skills/deploy/SKILL.md: name "ship" must equal the folder name "deploy"',
  ".repo/skills/deploy/SKILL.md: link ./steps.md does not exist",
  '.repo/rules/api.md: paths "srv/**" matches no file',
  '.repo/rules/x.md: unknown frontmatter key "colour"; use description, paths, overrides',
]
  .map((line) => `repo sync: ${line}\n`)
  .join("");
const NOTHING = "repo sync: nothing written\n";

function broken(): string {
  const root = tempDir();
  write(root, CONFIG_FILE, 'export default { packs: ["agents"], agents: { hosts: ["claude"] } }\n');
  write(root, "package.json", JSON.stringify({ name: "fixture" }));
  const scope = path.join(root, MODULES_DIR, "@workerstack");
  fs.mkdirSync(scope, { recursive: true });
  fs.symlinkSync(SELF_ROOT, path.join(scope, "repo"), "dir");
  write(root, ".repo/notes.md", "mine\n");
  write(root, ".repo/scripts/x.ts", "export {}\n");
  write(root, ".repo/skills/deploy/SKILL.md", "---\nname: ship\ndescription: d\n---\nSee [steps](./steps.md).\n");
  write(root, ".repo/rules/api.md", '---\ndescription: d\npaths: ["srv/**"]\n---\nApi.\n');
  write(root, ".repo/rules/x.md", '---\ndescription: d\npaths: ["package.json"]\ncolour: red\n---\nX.\n');
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}
function real(cwd: string, ...args: string[]) {
  return syncWith(cwd, {}, ...args);
}
/** Every file outside the linked package dir and the repo's own metadata, with its bytes. */
function tree(root: string, dir = ""): Record<string, string> {
  const found: Record<string, string> = {};
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (rel === MODULES_DIR || rel === GIT_DIR) continue;
    if (entry.isDirectory()) Object.assign(found, tree(root, rel));
    else found[rel] = fs.readFileSync(path.join(root, rel), "utf8");
  }
  return found;
}

it("prints every problem in one refusal with nothing written, and exits 1", async () => {
  const root = broken();
  const before = tree(root);
  expect(await real(root)).toStrictEqual({ code: 1, stderr: LINES + NOTHING, stdout: "" });
  expect(tree(root)).toStrictEqual(before);
});

it("--check prints the same lines without nothing written, and exits 1", async () => {
  const root = broken();
  const before = tree(root);
  expect(await real(root, "--check")).toStrictEqual({ code: 1, stderr: LINES, stdout: "" });
  expect(tree(root)).toStrictEqual(before);
});

it("--postinstall prints the lines and exits 0", async () => {
  const result = await real(broken(), "--postinstall");
  expect(result.code).toBe(0);
  expect(result.stderr).toBe(LINES + NOTHING);
});
