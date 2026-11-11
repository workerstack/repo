import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it, vi } from "vitest";

import { read, syncWith, tempDir, useSyncKit, write } from "./__fixtures__/sync-kit.ts";
import { CONFIG_FILE } from "./config.constants.ts";
import { MANIFEST_REL, renderManifest } from "./sync/manifest.ts";

useSyncKit();
vi.setConfig({ testTimeout: 120_000 });

const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OVERVIEW = '---\nroot: true\ntargets: ["*"]\nglobs: ["**/*"]\n---\n# Mine\n\nOur overview.\n';
const TESTING = '---\nroot: false\ntargets: ["*"]\nglobs:\n  - src/**\n---\n# Testing\n\nRun the tests.\n';

/**
 * A consumer on the stock package whose rules still carry root, targets and globs, with a `.grok/rules` file
 * an earlier sync wrote.
 */
function oldConsumer(): string {
  const root = tempDir();
  write(root, CONFIG_FILE, 'export default { packs: ["agents"], agents: { hosts: ["claude", "grok"] } }\n');
  write(root, "package.json", JSON.stringify({ name: "fixture" }));
  fs.mkdirSync(path.join(root, "node_modules", "@workerstack"), { recursive: true });
  fs.symlinkSync(SELF_ROOT, path.join(root, "node_modules", "@workerstack", "repo"), "dir");
  write(root, ".repo/rules/overview.md", OVERVIEW);
  write(root, ".repo/rules/testing.md", TESTING);
  write(root, ".grok/rules/testing.md", "Run the tests.\n");
  write(root, MANIFEST_REL, renderManifest([".grok/rules/testing.md"]));
  return root;
}

function real(cwd: string, ...args: string[]) {
  return syncWith(cwd, {}, ...args);
}

/** Every file outside the linked package dir, with its bytes. */
function files(root: string, dir = ""): Record<string, string> {
  const found: Record<string, string> = {};
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (rel === "node_modules") continue;
    if (entry.isSymbolicLink()) found[rel] = `-> ${fs.readlinkSync(path.join(root, rel))}`;
    else if (entry.isDirectory()) Object.assign(found, files(root, rel));
    else found[rel] = fs.readFileSync(path.join(root, rel), "utf8");
  }
  return found;
}

it("prints the rewrite and mark lines, then the summary with the removed .grok/rules file", async () => {
  const root = oldConsumer();
  const result = await real(root);
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  const lines = result.stdout.split("\n");
  expect(lines.slice(0, 3)).toStrictEqual([
    "repo sync: rewrote .repo/rules/overview.md frontmatter (description added, root, targets and globs dropped)",
    "repo sync: marked .repo/rules/overview.md with overrides: overview (it replaces the stock rule)",
    "repo sync: rewrote .repo/rules/testing.md frontmatter " +
      "(description added, globs → paths, root and targets dropped)",
  ]);
  expect(lines[3]).toMatch(/^repo sync: wrote .*AGENTS\.md.*; removed .*\.grok\/rules\/testing\.md/);
  expect(read(root, ".repo/rules/overview.md")).toBe(
    "---\ndescription: Mine\noverrides: overview\n---\n# Mine\n\nOur overview.\n",
  );
  expect(read(root, ".claude/rules/testing.md")).toBe("---\npaths:\n  - src/**\n---\n# Testing\n\nRun the tests.\n");
  expect(read(root, "AGENTS.md")).toContain("- `src/**`: read `.repo/rules/testing.md`");
  expect(fs.existsSync(path.join(root, ".grok/rules/testing.md"))).toBe(false);
});

it("converges: a second sync and --check have nothing to do", async () => {
  const root = oldConsumer();
  await real(root);
  const before = files(root);
  expect(await real(root)).toStrictEqual({ code: 0, stderr: "", stdout: "repo sync: up to date\n" });
  expect(await real(root, "--check")).toStrictEqual({ code: 0, stderr: "", stdout: "repo sync: up to date\n" });
  expect(files(root)).toStrictEqual(before);
});

it("--check counts the upgrade as migration steps and writes nothing", async () => {
  const root = oldConsumer();
  const before = files(root);
  expect(await real(root, "--check")).toStrictEqual({
    code: 1,
    stderr: "repo sync: 2 migration steps pending; run `bun repo sync`\n",
    stdout: "",
  });
  expect(files(root)).toStrictEqual(before);
});

it("--check prints the problems without a nothing-written line", async () => {
  const root = oldConsumer();
  write(root, ".repo/rules/overview.md", '---\ndescription: new\npaths: ["src/**"]\n---\nB\n');
  write(root, ".repo/rules/testing.md", '---\ndescription: t\npaths: ["src/**"]\n---\nB\n');
  expect(await real(root, "--check")).toStrictEqual({
    code: 1,
    stderr: "repo sync: .repo/rules/overview.md: a stock rule has this name; add `overrides: overview` or rename it\n",
    stdout: "",
  });
});

it("--check says step, not steps, for a single pending upgrade", async () => {
  const root = oldConsumer();
  write(root, ".repo/rules/testing.md", "---\ndescription: t\n---\nB\n");
  const { stderr } = await real(root, "--check");
  expect(stderr).toBe("repo sync: 1 migration step pending; run `bun repo sync`\n");
});

it("reports an upgrade that cannot write, and leaves the rule as it was", async () => {
  const root = oldConsumer();
  vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
    throw Object.assign(new Error("EACCES: permission denied, rename"), { code: "EACCES" });
  });
  const result = await real(root);
  expect(result.code).toBe(1);
  expect(result.stderr).toBe("repo sync: EACCES: permission denied, rename\n");
  expect(read(root, ".repo/rules/overview.md")).toBe(OVERVIEW);
});

it("prints one line per problem when new rules clash with stock or name nothing", async () => {
  const root = oldConsumer();
  write(root, ".repo/rules/overview.md", '---\ndescription: new\npaths: ["src/**"]\n---\nB\n');
  write(root, ".repo/rules/testing.md", "---\ndescription: t\noverrides: nope\n---\nB\n");
  write(root, ".repo/rules/bad.md", "no fence\n");
  const before = files(root);
  const result = await real(root);
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(
    [
      "repo sync: .repo/rules/bad.md: missing frontmatter (start the file with a --- block)",
      "repo sync: .repo/rules/overview.md: a stock rule has this name; add `overrides: overview` or rename it",
      'repo sync: .repo/rules/testing.md: overrides "nope" but no stock rule has that name',
      "repo sync: nothing written",
      "",
    ].join("\n"),
  );
  expect(files(root)).toStrictEqual(before);
});
