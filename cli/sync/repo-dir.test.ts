import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { fixtureDirs } from "../../dev/capture-tree-goldens.ts";
import { loadSources } from "./agents/load-sources.ts";
import { check, repo, rule, skill } from "./fixtures/repo-dir-kit.ts";
import { useTempDirs } from "./fixtures/temp-dirs.ts";
import { repoDirProblems } from "./repo-dir.ts";

const ALLOWED = [
  "rules/, subagents/, skills/, lessons/, tmp/, global-settings/, settings/claude.json, hooks.jsonc, ",
  "mcp-policy.jsonc, permissions.json, map.jsonc, lint-baseline.json (read by repo turn and repo check), ",
  "test-times.json (read by the vitest shard sequencer written by `bun repo ci times`)",
].join("");

useTempDirs();

it("passes when .repo does not exist", () => {
  expect(check(repo())).toStrictEqual([]);
});

it("passes every entry sync reads, and ignores whatever is in tmp/", () => {
  const root = repo({
    ".repo/global-settings/claude.json": "{}",
    ".repo/hooks.jsonc": "{}",
    ".repo/lessons/INDEX.md": "x",
    ".repo/lint-baseline.json": "{}",
    ".repo/map.jsonc": "{}",
    ".repo/mcp-policy.jsonc": "{}",
    ".repo/permissions.json": "{}",
    ".repo/rules/a.md": "x",
    ".repo/settings/claude.json": "{}",
    ".repo/skills/deploy/SKILL.md": skill("deploy"),
    ".repo/subagents/a.md": "x",
    ".repo/test-times.json": "{}",
    ".repo/tmp/anything/at/all.bin": "x",
  });
  expect(check(root)).toStrictEqual([]);
});

it("names an unknown file with the allowed list and where explanations go, mcp.json included", () => {
  expect(check(repo({ ".repo/mcp.json": "{}", ".repo/notes.md": "x" }))).toStrictEqual([
    `.repo/mcp.json: not part of .repo; allowed: ${ALLOWED}; explanations go in references/`,
    `.repo/notes.md: not part of .repo; allowed: ${ALLOWED}; explanations go in references/`,
  ]);
});

it("names an unknown folder with a trailing slash", () => {
  expect(check(repo({ ".repo/misc/a.md": "x" }))).toStrictEqual([
    `.repo/misc/: not part of .repo; allowed: ${ALLOWED}; explanations go in references/`,
  ]);
});

it("says nothing reads scripts/ or a settings file but claude.json, and names any other as not part of .repo", () => {
  const root = repo({
    ".repo/repo.pipeline.jsonc": "{}",
    ".repo/scripts/x.ts": "x",
    ".repo/settings/codex.json": "{}",
  });
  expect(check(root)).toStrictEqual([
    `.repo/repo.pipeline.jsonc: not part of .repo; allowed: ${ALLOWED}; explanations go in references/`,
    ".repo/scripts/: nothing reads it; move what you need out of .repo and delete it",
    ".repo/settings/codex.json: nothing reads it; move what you need out of .repo and delete it",
  ]);
});

const scoped = rule("api", "b", ["srv/**"]);

it("flags a glob that matches no listed file", () => {
  expect(check(repo(), [scoped], { listed: ["src/a.ts"] })).toStrictEqual([
    '.repo/rules/api.md: paths "srv/**" matches no file',
  ]);
});

it("passes a glob that matches a listed file and flags only the glob of several that does not", () => {
  expect(check(repo(), [scoped], { listed: ["srv/a.ts"] })).toStrictEqual([]);
  expect(check(repo(), [rule("api", "b", ["nope/**", "src/*.ts"])], { listed: ["src/a.ts"] })).toStrictEqual([
    '.repo/rules/api.md: paths "nope/**" matches no file',
  ]);
});

it("does not let .repo/tmp satisfy a glob", () => {
  expect(check(repo(), [rule("api", "b", ["**/*.json"])], { listed: [".repo/tmp/sync.json"] })).toStrictEqual([
    '.repo/rules/api.md: paths "**/*.json" matches no file',
  ]);
});

it("skips the check outside git", () => {
  expect(check(repo(), [scoped])).toStrictEqual([]);
});

function fixtureProblems({ withSrc }: { withSrc: boolean }): string[] {
  const root = repo();
  fs.cpSync(fixtureDirs().consumer, root, { recursive: true });
  const listed = fs
    .readdirSync(root, { encoding: "utf8", recursive: true })
    .map((rel) => rel.replaceAll("\\", "/"))
    .filter((rel) => fs.statSync(path.join(root, rel)).isFile());
  const loaded = loadSources({ consumerRoot: root, packages: [], stockRoot: fixtureDirs().stock });
  expect(loaded.problems).toStrictEqual([]);
  expect(fs.existsSync(path.join(root, "src"))).toBe(true);
  return repoDirProblems(root, {
    listed: withSrc ? listed : listed.filter((rel) => !rel.startsWith("src/")),
    packages: [],
    skills: [],
    sources: loaded.sources,
    stock: fixtureDirs().stock,
  });
}

it("passes, its src/** and src/index.ts rules matching the fixture's src file", () => {
  expect(fixtureProblems({ withSrc: true })).toStrictEqual([]);
});

it("would fail without the src file", () => {
  expect(fixtureProblems({ withSrc: false })).toStrictEqual([
    '.repo/rules/review-notes.md: paths "src/index.ts" matches no file',
    '.repo/rules/testing.md: paths "src/**" matches no file',
  ]);
});
