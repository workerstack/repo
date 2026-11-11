import fs from "node:fs";
import path from "node:path";

import { expect, it, vi } from "vitest";

import {
  BUNFIG,
  file,
  fixture,
  generating,
  link,
  only,
  read,
  snapshot,
  sync,
  syncWith,
  useSyncKit,
  write,
} from "./fixtures/sync-kit.ts";
import { failManifestRename } from "./sync/fixtures/write-kit.ts";
import { type Generator } from "./sync/outputs.ts";

useSyncKit();
const BAD_OVERLAY = JSON.stringify({ hooks: { PreToolUse: "x" } });
const SCHEMA_LINE =
  "repo sync: .claude/settings.json: hooks.PreToolUse: Invalid input: expected array, received string\n";
const settings = (text: string): Generator[] =>
  generating({ content: text, kind: "file", managed: "whole", path: ".claude/settings.json", tracked: false });

it("names a schema miss with its dotted path, writes nothing and exits 1", async () => {
  const root = fixture();
  const before = snapshot(root);
  const result = await syncWith(root, {
    generators: [...generating(file("bunfig.toml", BUNFIG)), ...settings(BAD_OVERLAY)],
  });
  expect(result).toEqual({ code: 1, stderr: `${SCHEMA_LINE}repo sync: nothing written\n`, stdout: "" });
  expect(snapshot(root)).toEqual(before);
});

it("--check reports the same line and exits 1 without a nothing-written line", async () => {
  const root = fixture();
  const result = await syncWith(root, { generators: settings(BAD_OVERLAY) }, "--check");
  expect(result).toEqual({ code: 1, stderr: SCHEMA_LINE, stdout: "" });
});

it("--postinstall prints the lines and exits 0", async () => {
  const root = fixture();
  const result = await syncWith(root, { generators: settings(BAD_OVERLAY) }, "--postinstall");
  expect(result).toEqual({ code: 0, stderr: `${SCHEMA_LINE}repo sync: nothing written\n`, stdout: "" });
});

it("refuses an output path with no registered format", async () => {
  const root = fixture();
  const before = snapshot(root);
  const result = await syncWith(root, { generators: generating(file("docs/x.yaml", "a: 1\n")) });
  expect(result).toEqual({
    code: 1,
    stderr:
      "repo sync: docs/x.yaml: no output format registered; add it to cli/sync/validate.ts\nrepo sync: nothing written\n",
    stdout: "",
  });
  expect(snapshot(root)).toEqual(before);
});

it("accepts a valid overlay result", async () => {
  const root = fixture();
  const good = JSON.stringify({ hooks: { PreToolUse: [] } });
  const { code } = await syncWith(root, { generators: settings(good) });
  expect(code).toBe(0);
  expect(read(root, ".claude/settings.json")).toBe(good);
});

it("refuses a link that points nowhere", async () => {
  const root = fixture();
  const result = await syncWith(root, {
    generators: generating(link(".claude/skills/ask", "../../.agents/skills/ask")),
  });
  expect(result.stderr).toBe(
    "repo sync: .claude/skills/ask: link target ../../.agents/skills/ask does not exist\nrepo sync: nothing written\n",
  );
});

it("refuses a real dir where a skill link goes and writes nothing", async () => {
  // Only this repo skips adoption, which would otherwise move the dir to .repo/skills.
  const root = fixture();
  write(root, "package.json", JSON.stringify({ name: "@workerstack/repo" }));
  write(root, ".claude/skills/ask/SKILL.md", "mine\n");
  fs.mkdirSync(path.join(root, ".agents/skills/ask"), { recursive: true });
  const before = snapshot(root);
  const outputs = generating(file("bunfig.toml", BUNFIG), link(".claude/skills/ask", "../../.agents/skills/ask"));
  expect(await syncWith(root, { generators: outputs })).toEqual({
    code: 1,
    stderr:
      "repo sync: .claude/skills/ask is a folder where sync puts a link; move it to .repo/skills/ask\nrepo sync: nothing written\n",
    stdout: "",
  });
  expect(snapshot(root)).toEqual(before);
});

it("restores everything when a write fails on the manifest", async () => {
  const root = fixture();
  await syncWith(root, only(file("old.txt")));
  const before = snapshot(root);
  failManifestRename();
  const result = await syncWith(root, only(file("a.txt")));
  expect(result).toEqual({
    code: 1,
    stderr:
      "repo sync: .repo/tmp/sync.json: cannot write: EACCES: permission denied, rename; restored 2 outputs, nothing changed\n",
    stdout: "",
  });
  vi.restoreAllMocks();
  expect(snapshot(root)).toEqual(before);
});

it("--check still names a hand edit as out of date", async () => {
  const root = fixture();
  await sync(root);
  write(root, "bunfig.toml", `${BUNFIG}# hand edit\n`);
  expect(await sync(root, "--check")).toEqual({
    code: 1,
    stderr: "repo sync: bunfig.toml is out of date; run `bun repo sync`\n",
    stdout: "",
  });
});
