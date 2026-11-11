import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { BUNFIG, age, fixture, mtimes, read, region, snapshot, sync, useSyncKit, write } from "./fixtures/sync-kit.ts";

useSyncKit();

const GITIGNORE = region("# ", "", ["ignore", ".tmp/\n.worktrees/\n.repo/tmp/\ncoverage/\nnode_modules/"]);
const GITATTRIBUTES = region("# ", "", ["generated", "* text=auto eol=lf\nbunfig.toml linguist-generated"]);
const SETTINGS = '{\n  "files.readonlyInclude": {\n    "bunfig.toml": true\n  }\n}\n';
const API_ENTRY = "- [@acme/api](../packages/api/references/INDEX.md): API worker";
const STACK_ENTRY = "- [@workerstack/repo](../node_modules/@workerstack/repo/references/INDEX.md)";
const PACKAGES_REGION = region("<!-- ", " -->", ["packages", API_ENTRY]);
const STACK_REGION = region("<!-- ", " -->", ["stack", STACK_ENTRY]);
const INDEX = `# References\n\n${PACKAGES_REGION}\n${STACK_REGION}`;

it("writes every output under the root on the first run, then reports up to date, touching nothing", async () => {
  const root = fixture();

  expect(await sync(root)).toStrictEqual({
    code: 0,
    stderr: "",
    stdout:
      "repo sync: wrote bunfig.toml, references/INDEX.md, packages/api/references/INDEX.md, " +
      ".gitignore, .gitattributes, .vscode/settings.json\n",
  });
  expect(read(root, "bunfig.toml")).toBe(BUNFIG);
  expect(read(root, ".gitignore")).toBe(GITIGNORE);
  expect(read(root, ".gitattributes")).toBe(GITATTRIBUTES);
  expect(read(root, ".vscode/settings.json")).toBe(SETTINGS);
  expect(read(root, "references/INDEX.md")).toBe(INDEX);

  age(root);
  const before = mtimes(root);
  expect(await sync(root)).toStrictEqual({ code: 0, stderr: "", stdout: "repo sync: up to date\n" });
  expect(mtimes(root)).toStrictEqual(before);
});

it("refuses a config without the agents pack in this repo, whose trees are the stock source", async () => {
  const root = fixture('export default { packs: ["docs"] }\n');
  write(root, "package.json", JSON.stringify({ name: "@workerstack/repo" }));
  write(root, ".claude/skills/ask/SKILL.md", "stock\n");
  expect(await sync(root)).toStrictEqual({
    code: 1,
    stderr:
      "repo sync: workerstack.config.ts: this repo ships the agent trees as its stock source; " +
      'keep "agents" in packs\nrepo sync: nothing written\n',
    stdout: "",
  });
  expect(read(root, ".claude/skills/ask/SKILL.md")).toBe("stock\n");
  expect(fs.existsSync(path.join(root, "bunfig.toml"))).toBe(false);
});

it("finds the root from a nested cwd and writes there", async () => {
  const root = fixture();
  const { code } = await sync(path.join(root, "packages", "api"));
  expect(code).toBe(0);
  expect(read(root, "bunfig.toml")).toBe(BUNFIG);
  expect(fs.existsSync(path.join(root, "packages", "api", "bunfig.toml"))).toBe(false);
});

it("rewrites only the files that drifted and leaves no temp files", async () => {
  const root = fixture();
  await sync(root);
  write(root, "bunfig.toml", `${BUNFIG}x\n`);
  age(root);
  const [, ...kept] = mtimes(root);

  expect(await sync(root)).toStrictEqual({ code: 0, stderr: "", stdout: "repo sync: wrote bunfig.toml\n" });
  expect(read(root, "bunfig.toml")).toBe(BUNFIG);
  expect(mtimes(root).slice(1)).toStrictEqual(kept);
  expect(fs.readdirSync(root).filter((name) => name.includes(".tmp"))).toStrictEqual([]);
});

it("keeps the hand-written text around the managed parts", async () => {
  const root = fixture();
  write(root, ".gitignore", "node_modules/\n.tmp/\n");
  write(root, "references/INDEX.md", "# Docs\n\nHand-written.\n");
  await sync(root);
  expect(read(root, ".gitignore")).toBe(`node_modules/\n.tmp/\n\n${GITIGNORE}`);
  expect(read(root, "references/INDEX.md")).toBe(`# Docs\n\nHand-written.\n${INDEX.slice("# References\n".length)}`);
});

it("treats a file whose bytes differ only in line endings as drifted", async () => {
  const root = fixture();
  await sync(root);
  write(root, "bunfig.toml", BUNFIG.replaceAll("\n", "\r\n"));
  expect(await sync(root, "--check")).toStrictEqual({
    code: 1,
    stderr: "repo sync: bunfig.toml is out of date; run `bun repo sync`\n",
    stdout: "",
  });
});

it("--check reports up to date and exits 0 when nothing drifted", async () => {
  const root = fixture();
  await sync(root);
  expect(await sync(root, "--check")).toStrictEqual({ code: 0, stderr: "", stdout: "repo sync: up to date\n" });
});

it("--check names every stale file, exits 1 and writes nothing", async () => {
  const root = fixture();
  write(root, "bunfig.toml", `${BUNFIG}x\n`);
  const before = snapshot(root);

  expect(await sync(root, "--check")).toStrictEqual({
    code: 1,
    stderr:
      "repo sync: bunfig.toml is out of date; run `bun repo sync`\n" +
      "repo sync: references/INDEX.md is out of date; run `bun repo sync`\n" +
      "repo sync: packages/api/references/INDEX.md is out of date; run `bun repo sync`\n" +
      "repo sync: .gitignore is out of date; run `bun repo sync`\n" +
      "repo sync: .gitattributes is out of date; run `bun repo sync`\n" +
      "repo sync: .vscode/settings.json is out of date; run `bun repo sync`\n",
    stdout: "",
  });
  expect(snapshot(root)).toStrictEqual(before);
});
