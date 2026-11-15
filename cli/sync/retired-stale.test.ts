import { expect, it } from "vitest";

import { exists, plain, read, readJson, sync, write } from "./__fixtures__/copied-install.ts";
import { useTempDirs } from "./__fixtures__/temp-dirs.ts";
import { MANIFEST_REL, readManifest, renderManifest } from "./manifest.ts";

useTempDirs();

const OLD_GROK = ".grok/hooks/rulesync.json";

/** The empty grok hook file every older sync copied. */
const OLD_GROK_TEXT = '{\n  "hooks": {}\n}\n';
const AGENTS_HOOKS = ".agents/hooks.json";
const STALE = `repo sync: ${OLD_GROK} is stale and would be removed; run \`bun repo sync\`\n`;

type AgentsHooks = Record<string, Record<string, unknown[]>>;

/** A consumer an older sync left without a manifest, holding the old grok file as `text`. */
function unrecorded(text: string = OLD_GROK_TEXT): string {
  return plain({ [OLD_GROK]: text }, { git: false });
}

/** A consumer synced once, so its manifest names what sync wrote. */
async function synced(): Promise<string> {
  const root = plain({}, { git: false });
  const result = await sync(root, [], true);
  expect(result.code).toBe(0);

  return root;
}

/** The lines of a run that name the old grok file. */
function naming(lines: readonly string[]): string[] {
  return lines.filter((line) => line.includes(OLD_GROK));
}

it("removes an unedited old grok rulesync.json once, and a second sync removes nothing", async () => {
  const root = unrecorded();
  const first = await sync(root, [], true);

  expect([first.code, first.err.join("")]).toStrictEqual([0, ""]);
  expect(naming(first.out)).toHaveLength(1);
  expect(naming(first.out)[0]).toMatch(/removed .*\.grok\/hooks\/rulesync\.json/);
  expect(exists(root, OLD_GROK)).toBe(false);

  const again = await sync(root, [], true);

  expect(again.code).toBe(0);
  expect(again.out.join("")).not.toContain("removed");
});

it("--check names the old grok file as stale and leaves it", async () => {
  const root = unrecorded();
  const checked = await sync(root, ["--check"], true);

  expect(checked.code).toBe(1);
  expect(checked.err).toContain(STALE);
  expect(read(root, OLD_GROK)).toBe(OLD_GROK_TEXT);
});

it("keeps an old grok rulesync.json the consumer edited", async () => {
  const edited = '{\n  "hooks": { "Stop": [] }\n}\n';
  const root = unrecorded(edited);
  const result = await sync(root, [], true);

  expect([result.code, result.err.join("")]).toStrictEqual([0, ""]);
  expect(naming(result.out)).toStrictEqual([]);
  expect(read(root, OLD_GROK)).toBe(edited);
});

it("upgrades the old files a previous sync wrote: the same hooks, in order, under repo, and no grok file", async () => {
  const root = await synced();
  const current = readJson<AgentsHooks>(root, AGENTS_HOOKS);
  write(root, AGENTS_HOOKS, `${JSON.stringify({ rulesync: current.repo }, null, 2)}\n`);
  write(root, OLD_GROK, OLD_GROK_TEXT);
  write(root, MANIFEST_REL, renderManifest([...readManifest(root).paths, OLD_GROK]));

  const result = await sync(root, [], true);

  expect([result.code, result.err.join("")]).toStrictEqual([0, ""]);
  expect(naming(result.out)).toHaveLength(1);
  expect(exists(root, OLD_GROK)).toBe(false);
  expect(readJson<AgentsHooks>(root, AGENTS_HOOKS)).toStrictEqual(current);
  expect(Object.keys(current)).toStrictEqual(["repo"]);
  expect(Object.keys(current.repo ?? {}).length).toBeGreaterThan(0);
});
