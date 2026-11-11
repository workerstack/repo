import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { syncWith, tempDir, useSyncKit, write } from "./__fixtures__/sync-kit.ts";
import { CONFIG_FILE } from "./config.constants.ts";
import { standards } from "./sync/standards.ts";

useSyncKit();
function hooksGit(cwd: string, ...args: string[]) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}
function hooksPath(root: string) {
  return hooksGit(root, "config", "--local", "--get", "core.hooksPath").stdout.trim();
}
/**
 * A temp git repo with `packs`, its git kept from the user's global config by an empty one of its own, which
 * `global` writes to.
 */
function hooksRepo(packs = '["standards"]') {
  const root = fs.realpathSync(tempDir());
  const globalConfig = path.join(tempDir(), "global.gitconfig");
  fs.writeFileSync(globalConfig, "");
  vi.stubEnv("GIT_CONFIG_GLOBAL", globalConfig);
  hooksGit(root, "init", "-q");
  write(root, "package.json", JSON.stringify({ name: "app" }));
  write(root, CONFIG_FILE, `export default { packs: ${packs} }\n`);
  return { global: (text: string) => fs.writeFileSync(globalConfig, text), root };
}
function syncHooks(root: string, ...args: string[]) {
  return syncWith(root, { generators: [], post: [standards] }, ...args);
}
function foreign(value: string, scope = "") {
  return (
    `repo sync: core.hooksPath is ${value}, so repo's hooks never run; ` +
    `unset it (git config ${scope}--unset core.hooksPath) and sync again\n`
  );
}
const UP_TO_DATE = { code: 0, stderr: "", stdout: "repo sync: up to date\n" };

it("points core.hooksPath at the hooks when it is unset, then leaves it", async () => {
  const { root } = hooksRepo();
  const { stdout } = await syncHooks(root);
  expect(stdout).toMatch(/; set core\.hooksPath to \.githooks(?:; marked .* executable in the index)?\n$/);
  expect(hooksPath(root)).toBe(".githooks");
  expect(await syncHooks(root)).toStrictEqual(UP_TO_DATE);
  hooksGit(root, "config", "--unset", "core.hooksPath");
  const { stdout: postinstall } = await syncHooks(root, "--postinstall");
  expect(postinstall).toBe("repo sync: set core.hooksPath to .githooks\n");
  expect(hooksPath(root)).toBe(".githooks");
});

it("reports a foreign value on every run and changes nothing", async () => {
  const { root } = hooksRepo();
  hooksGit(root, "config", "core.hooksPath", ".husky");
  const reported = { code: 0, stderr: foreign(".husky"), stdout: expect.any(String) as unknown };
  expect(await syncHooks(root)).toStrictEqual(reported);
  expect(await syncHooks(root, "--postinstall")).toStrictEqual(reported);
  expect(hooksPath(root)).toBe(".husky");
});

it("unsets only its own value", async () => {
  const { root } = hooksRepo("[]");
  hooksGit(root, "config", "core.hooksPath", ".githooks");
  expect(await syncHooks(root)).toStrictEqual({ code: 0, stderr: "", stdout: "repo sync: unset core.hooksPath\n" });
  expect(hooksGit(root, "config", "--local", "--get", "core.hooksPath").status).toBe(1);
  hooksGit(root, "config", "core.hooksPath", ".husky");
  expect(await syncHooks(root)).toStrictEqual(UP_TO_DATE);
  expect(hooksPath(root)).toBe(".husky");
});

it("leaves its own value alone when it comes from another scope than the repo's", async () => {
  const { root, global } = hooksRepo("[]");
  global("[core]\n\thooksPath = .githooks\n");
  expect(await syncHooks(root)).toStrictEqual(UP_TO_DATE);
});

it("--check never reads or writes it", async () => {
  const { root } = hooksRepo();
  await syncHooks(root);
  hooksGit(root, "config", "--unset", "core.hooksPath");
  expect(await syncHooks(root, "--check")).toStrictEqual(UP_TO_DATE);
  hooksGit(root, "config", "core.hooksPath", ".husky");
  expect(await syncHooks(root, "--check")).toStrictEqual(UP_TO_DATE);
  expect(hooksPath(root)).toBe(".husky");
});

it("leaves the config of a repo it is nested in, whose toplevel is not the sync root", async () => {
  const { root: outer } = hooksRepo("[]");
  hooksGit(outer, "config", "core.hooksPath", ".githooks");
  const inner = path.join(outer, "inner");
  write(inner, "package.json", JSON.stringify({ name: "inner" }));
  write(inner, CONFIG_FILE, "export default { packs: [] }\n");
  expect(await syncHooks(inner)).toStrictEqual(UP_TO_DATE);
  expect(hooksPath(outer)).toBe(".githooks");
});

it("names the scope that holds a foreign value", async () => {
  const { root, global } = hooksRepo();
  global("[core]\n\thooksPath = ~/hooks\n");
  const { stderr } = await syncHooks(root);
  expect(stderr).toBe(foreign("~/hooks", "--global "));
});

it("says when git cannot set it, and tries again on the next run", async () => {
  const { root } = hooksRepo();
  function fake(_root: string, args: readonly string[]) {
    if (args[0] === "rev-parse") return { status: 0, stderr: "", stdout: `${root}\n` };
    if (args.includes("--get")) return { status: 1, stderr: "", stdout: "" };
    return { status: 255, stderr: "error: could not lock config file\n", stdout: "" };
  }
  const result = await syncWith(root, { generators: [], git: fake, post: [standards] });
  expect(result).toMatchObject({
    code: 0,
    stderr: "repo sync: cannot set core.hooksPath to .githooks: error: could not lock config file\n",
  });
  const { stdout } = await syncHooks(root);
  expect(stdout).toMatch(/^repo sync: set core\.hooksPath to \.githooks(?:; marked .* executable in the index)?\n$/);
});

// The next test covers win32, which has no execute bits to lose.
it.skipIf(process.platform === "win32")(
  "rewrites a hook that lost its execute bits, which --check reports",
  async () => {
    const { root } = hooksRepo();
    await syncHooks(root);
    fs.chmodSync(path.join(root, ".githooks/pre-commit"), 0o644);
    const stale = "repo sync: .githooks/pre-commit is out of date; run `bun repo sync`\n";
    const { stderr } = await syncHooks(root, "--check");
    expect(stderr).toBe(stale);
    await syncHooks(root);
    expect(fs.statSync(path.join(root, ".githooks/pre-commit")).mode & 0o777).toBe(0o555);
  },
);

it("does not compare execute bits on win32, which has none", async () => {
  const { root } = hooksRepo();
  await syncHooks(root);
  fs.chmodSync(path.join(root, ".githooks/pre-commit"), 0o644);
  const win32 = { generators: [], platform: "win32" as const, post: [standards] };
  expect(await syncWith(root, win32, "--check")).toStrictEqual(UP_TO_DATE);
});
