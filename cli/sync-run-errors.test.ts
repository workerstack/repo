import fs from "node:fs";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { BUNFIG, fixture, snapshot, sync, syncWith, tempDir, useSyncKit, write } from "./__fixtures__/sync-kit.ts";
import { CONFIG_FILE } from "./config.constants.ts";

useSyncKit();

const NOTHING_WRITTEN = String.raw`\nrepo sync: nothing written\n$`;

/** Syncs `root`, expecting a refusal that prints nothing to stdout and changes no file; what it printed. */
async function refused(root: string): Promise<string> {
  const before = snapshot(root);
  const result = await sync(root);
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(snapshot(root)).toStrictEqual(before);
  return result.stderr;
}

it("a config error exits 1 and leaves every file byte-identical", async () => {
  const root = fixture("export default { pakcs: [] }\n");
  write(root, "bunfig.toml", `${BUNFIG}x\n`);
  write(root, ".gitignore", "node_modules/\n");
  const before = snapshot(root);

  expect(await sync(root)).toStrictEqual({
    code: 1,
    stderr: 'repo sync: workerstack.config.ts: unknown key "pakcs"\nrepo sync: nothing written\n',
    stdout: "",
  });
  expect(snapshot(root)).toStrictEqual(before);
});

it("a generator error exits 1 and writes none of the valid outputs", async () => {
  const root = fixture();
  write(root, "bunfig.toml", `${BUNFIG}x\n`);
  fs.rmSync(path.join(root, "packages/api/references/INDEX.md"));
  const before = snapshot(root);

  expect(await sync(root)).toStrictEqual({
    code: 1,
    stderr:
      "repo sync: packages/api has no references/INDEX.md; every workspace package needs one\n" +
      "repo sync: nothing written\n",
    stdout: "",
  });
  expect(snapshot(root)).toStrictEqual(before);
});

it("a workspace error exits 1 and writes nothing", async () => {
  const root = fixture();
  write(root, "packages/api/package.json", "{");
  const stderr = await refused(root);
  const pattern = String.raw`^repo sync: packages\/api\/package\.json: not valid JSON: .+${NOTHING_WRITTEN}`;
  expect(stderr).toMatch(new RegExp(pattern));
});

it("reports a file it cannot read instead of treating it as missing", async () => {
  const root = fixture();
  write(root, "references/INDEX.md/stray.txt", "a directory where the index belongs\n");
  const stderr = await refused(root);
  const pattern = String.raw`^repo sync: references\/INDEX\.md: cannot read: EISDIR\b.*${NOTHING_WRITTEN}`;
  expect(stderr).toMatch(new RegExp(pattern));
});

it("reports a failed write, removes its temp file and exits 1", async () => {
  const root = fixture();
  const rename = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
    throw Object.assign(new Error("EACCES: permission denied, rename"), { code: "EACCES" });
  });

  expect(await sync(root)).toStrictEqual({
    code: 1,
    stderr:
      "repo sync: bunfig.toml: cannot write: EACCES: permission denied, rename; restored 0 outputs, nothing changed\n",
    stdout: "",
  });
  expect(rename).toHaveBeenCalledOnce();
  expect(fs.readdirSync(root).toSorted()).toStrictEqual([CONFIG_FILE, "package.json", "packages"].toSorted());
});

it("--postinstall prints an error and exits 0", async () => {
  const root = fixture("export default { pakcs: [] }\n");
  expect(await sync(root, "--postinstall")).toStrictEqual({
    code: 0,
    stderr: 'repo sync: workerstack.config.ts: unknown key "pakcs"\nrepo sync: nothing written\n',
    stdout: "",
  });
  expect(fs.existsSync(path.join(root, "bunfig.toml"))).toBe(false);
});

it("--postinstall reapplies the links from the root, and no other mode does", async () => {
  const root = tempDir();
  write(root, CONFIG_FILE, "export default {};\n");
  const calls: string[] = [];
  function reapply(cwd: string) {
    return void calls.push(cwd);
  }
  await syncWith(root, { generators: [], reapply }, "--postinstall");
  await syncWith(root, { generators: [], reapply });
  await syncWith(root, { generators: [], reapply }, "--check");
  expect(calls).toStrictEqual([root]);
});

it("--postinstall reapplies even when the sync itself reports an error", async () => {
  const root = tempDir();
  const calls: string[] = [];
  await syncWith(root, { generators: [], reapply: (cwd) => void calls.push(cwd) }, "--postinstall");
  expect(calls).toStrictEqual([root]);
});

it("--postinstall with no links prints exactly what it printed before", async () => {
  const root = tempDir();
  write(root, CONFIG_FILE, "export default {};\n");
  expect(await syncWith(root, { generators: [] }, "--postinstall")).toStrictEqual({
    code: 0,
    stderr: "",
    stdout: "repo sync: up to date\n",
  });
});

it("--postinstall writes like a plain run when there is no error", async () => {
  const root = fixture();
  expect(await sync(root, "--postinstall")).toStrictEqual({
    code: 0,
    stderr: "",
    stdout:
      "repo sync: wrote bunfig.toml, references/INDEX.md, packages/api/references/INDEX.md, " +
      ".gitignore, .gitattributes, .vscode/settings.json\n",
  });
});

it("says to run repo init when no config exists in cwd or any parent", async () => {
  const cwd = tempDir();
  expect(await sync(cwd)).toStrictEqual({
    code: 1,
    stderr: `repo sync: no workerstack.config.ts in ${cwd} or any parent; run \`bun repo init\`\n`,
    stdout: "",
  });
  expect(fs.readdirSync(cwd)).toStrictEqual([]);
  const { code } = await sync(cwd, "--postinstall");
  expect(code).toBe(0);
});

it("produces identical bytes across runs and roots", async () => {
  const first = fixture();
  const second = fixture();
  await sync(first);
  const once = snapshot(first);
  await sync(first);
  await sync(second);
  expect(snapshot(first)).toStrictEqual(once);
  expect(snapshot(second)).toStrictEqual(once);
});

it.each([
  [["--force"], "repo sync: unknown flag --force; use --check or --postinstall\n"],
  [["extra"], "repo sync: unknown flag extra; use --check or --postinstall\n"],
  [["--check", "--postinstall"], "repo sync: use --check or --postinstall, not both\n"],
])("%j is a usage error that exits 1 and writes nothing", async (args, stderr) => {
  const root = fixture();
  const before = snapshot(root);
  expect(await sync(root, ...args)).toStrictEqual({ code: 1, stderr, stdout: "" });
  expect(snapshot(root)).toStrictEqual(before);
});
