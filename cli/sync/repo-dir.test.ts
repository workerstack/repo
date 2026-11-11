import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { fixtureDirs } from "../../dev/capture-tree-goldens.ts";
import type { SkillPack } from "../config.ts";
import { loadSources, type Doc, type Sources } from "./agents/sources.ts";
import { repoDirProblems } from "./repo-dir.ts";

/** Past the 12 KiB the always-on budget once capped pathless rules at. */
const BIG_RULE_BYTES = 13_000;
const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ALLOWED =
  "rules/, subagents/, skills/, lessons/, tmp/, global-settings/, settings/claude.json, hooks.jsonc, mcp-policy.jsonc, permissions.json, map.jsonc, lint-baseline.json (read by repo turn and repo check), test-times.json (read by the vitest shard sequencer written by `bun repo ci times`)";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { force: true, recursive: true });
});

function repo(files: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-repo-dir-"));
  temps.push(root);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

function rule(name: string, body: string, paths?: string[]): Doc {
  return {
    body,
    data: { description: "d", ...(paths ? { paths } : {}) },
    file: `${name}.md`,
    origin: "repo",
    rel: `.repo/rules/${name}.md`,
    scope: "",
  };
}

const sourcesOf = (rules: Doc[] = []): Sources => ({
  hooks: { rel: "agents/hooks.jsonc", value: {} },
  rules,
  subagents: [],
});

function check(
  root: string,
  rules: Doc[] = [],
  listed: string[] | null = null,
  skills: readonly SkillPack[] = [],
  packages: string[] = [],
): string[] {
  return repoDirProblems(root, { listed, packages, skills, sources: sourcesOf(rules), stock: SELF_ROOT });
}

const skill = (name: string, description = "does a thing", body = "") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;

describe("the layout", () => {
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

  it("says nothing reads scripts/ or a settings file other than claude.json, and names any other copied file as not part of .repo", () => {
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
});

describe("skills", () => {
  it("flags a skill folder without SKILL.md", () => {
    expect(check(repo({ ".repo/skills/deploy/notes.md": "x" }))).toStrictEqual([
      ".repo/skills/deploy: SKILL.md is missing; add it or delete the folder",
    ]);
  });

  it("flags a file straight under skills/", () => {
    expect(check(repo({ ".repo/skills/README.md": "x" }))).toStrictEqual([
      ".repo/skills/README.md: not a skill folder; skills are skills/<name>/SKILL.md",
    ]);
  });

  it("requires name to equal the folder name", () => {
    expect(check(repo({ ".repo/skills/deploy/SKILL.md": skill("ship") }))).toStrictEqual([
      '.repo/skills/deploy/SKILL.md: name "ship" must equal the folder name "deploy"',
    ]);
    expect(check(repo({ ".repo/skills/deploy/SKILL.md": "---\ndescription: d\n---\n" }))).toStrictEqual([
      '.repo/skills/deploy/SKILL.md: name is required; set it to the folder name "deploy"',
    ]);
  });

  it("requires a description of at most 1024 characters", () => {
    expect(check(repo({ ".repo/skills/deploy/SKILL.md": "---\nname: deploy\n---\n" }))).toStrictEqual([
      ".repo/skills/deploy/SKILL.md: description is required",
    ]);
    expect(check(repo({ ".repo/skills/deploy/SKILL.md": skill("deploy", "a".repeat(1025)) }))).toStrictEqual([
      ".repo/skills/deploy/SKILL.md: description is 1025 characters, over the 1024 limit; shorten it",
    ]);
    expect(check(repo({ ".repo/skills/deploy/SKILL.md": skill("deploy", "a".repeat(1024)) }))).toStrictEqual([]);
  });

  it("reports unreadable frontmatter once", () => {
    expect(check(repo({ ".repo/skills/deploy/SKILL.md": "plain\n" }))).toStrictEqual([
      ".repo/skills/deploy/SKILL.md: missing frontmatter (start the file with a --- block)",
    ]);
  });

  it("flags a dead link, resolved from the skill's folder", () => {
    const body = "See [steps](./steps.md#top) and [more](refs/more.md).\n";
    const root = repo({
      ".repo/skills/deploy/SKILL.md": skill("deploy", "d", body),
      ".repo/skills/deploy/refs/more.md": "x",
    });
    expect(check(root)).toStrictEqual([".repo/skills/deploy/SKILL.md: link ./steps.md does not exist"]);
    fs.writeFileSync(path.join(root, ".repo/skills/deploy/steps.md"), "x");
    expect(check(root)).toStrictEqual([]);
  });

  it("asks a skill named like a stock skill for overrides, unless its pack is off", () => {
    const root = repo({ ".repo/skills/ask/SKILL.md": skill("ask") });
    expect(check(root)).toStrictEqual([
      ".repo/skills/ask: a stock skill has this name; add `overrides: ask` to its SKILL.md or rename it",
    ]);
    const ok = repo({ ".repo/skills/ask/SKILL.md": `---\nname: ask\ndescription: d\noverrides: ask\n---\n` });
    expect(check(ok)).toStrictEqual([]);
    const bad = repo({ ".repo/skills/mine/SKILL.md": `---\nname: mine\ndescription: d\noverrides: nope\n---\n` });
    expect(check(bad)).toStrictEqual(['.repo/skills/mine/SKILL.md: overrides "nope" but no stock skill has that name']);
  });

  it("does not ask for overrides when the stock is this repo itself", () => {
    const root = repo({ ".repo/skills/ask/SKILL.md": skill("ask") });
    expect(
      repoDirProblems(root, { listed: null, packages: [], skills: [], sources: sourcesOf(), stock: root }),
    ).toStrictEqual([]);
  });
});

describe("rule links", () => {
  it("resolves from the repo root, not from the rules folder", () => {
    const root = repo({ ".repo/rules/b.md": "x", "references/a.md": "x" });
    expect(check(root, [rule("r", "[a](references/a.md) and [a](./references/a.md#sec)")])).toStrictEqual([]);
    expect(check(root, [rule("r", "[b](b.md)")])).toStrictEqual([".repo/rules/r.md: link b.md does not exist"]);
  });

  it("flags a dead link", () => {
    expect(check(repo(), [rule("r", "[gone](references/gone.md)")])).toStrictEqual([
      ".repo/rules/r.md: link references/gone.md does not exist",
    ]);
  });

  it("skips external links, anchors, absolute paths and code", () => {
    const body = [
      "[a](https://example.com/x) [b](http://example.com) [c](mailto:me@example.com) [d](#top) [e](/abs/path)",
      "`[f](nope.md)`",
      "```",
      "[g](nope.md)",
      "```",
    ].join("\n");
    expect(check(repo(), [rule("r", body)])).toStrictEqual([]);
  });

  it("does not check a stock rule", () => {
    const stock: Doc = {
      body: "[x](nope.md)",
      data: { description: "d" },
      file: "s.md",
      origin: "stock",
      rel: "agents/rules/s.md",
      scope: "",
    };
    expect(check(repo(), [stock])).toStrictEqual([]);
  });
});

describe("paths globs", () => {
  const scoped = rule("api", "b", ["srv/**"]);

  it("flags a glob that matches no listed file", () => {
    expect(check(repo(), [scoped], ["src/a.ts"])).toStrictEqual(['.repo/rules/api.md: paths "srv/**" matches no file']);
  });

  it("passes a glob that matches a listed file and flags only the glob of several that does not", () => {
    expect(check(repo(), [scoped], ["srv/a.ts"])).toStrictEqual([]);
    expect(check(repo(), [rule("api", "b", ["nope/**", "src/*.ts"])], ["src/a.ts"])).toStrictEqual([
      '.repo/rules/api.md: paths "nope/**" matches no file',
    ]);
  });

  it("does not let .repo/tmp satisfy a glob", () => {
    expect(check(repo(), [rule("api", "b", ["**/*.json"])], [".repo/tmp/sync.json"])).toStrictEqual([
      '.repo/rules/api.md: paths "**/*.json" matches no file',
    ]);
  });

  it("skips the check outside git", () => {
    expect(check(repo(), [scoped], null)).toStrictEqual([]);
  });
});

describe("the golden consumer", () => {
  function fixtureProblems(withSrc: boolean): string[] {
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
    expect(fixtureProblems(true)).toStrictEqual([]);
  });

  it("would fail without the src file", () => {
    expect(fixtureProblems(false)).toStrictEqual([
      '.repo/rules/review-notes.md: paths "src/index.ts" matches no file',
      '.repo/rules/testing.md: paths "src/**" matches no file',
    ]);
  });
});

describe("a workspace package's .repo", () => {
  const WEB = "packages/web";
  const pkgRule = (name: string, body: string, paths?: string[], data: Record<string, unknown> = {}): Doc => ({
    body,
    data: { description: "d", ...(paths ? { paths } : {}), ...data },
    file: `${name}.md`,
    origin: "repo",
    rel: `${WEB}/.repo/rules/${name}.md`,
    scope: WEB,
  });
  const inPkg = (rules: Doc[], listed: string[] | null = null, files: Record<string, string> = {}) =>
    check(repo(files), rules, listed, [], [WEB]);

  it("passes rules and skills, a pathless rule, and a path rule that matches a file under the package", () => {
    const root = repo({
      [`${WEB}/.repo/rules/api.md`]: "x",
      [`${WEB}/.repo/skills/deploy/SKILL.md`]: skill("deploy", "ships it"),
    });
    const rules = [pkgRule("api", "Api.", ["src/api/**"]), pkgRule("all", "All.")];
    expect(check(root, rules, [`${WEB}/src/api/a.ts`], [], [WEB])).toStrictEqual([]);
  });

  it("refuses every entry but rules/ and skills/, subagents and lessons with where they live", () => {
    const root = repo({
      [`${WEB}/.repo/lessons/INDEX.md`]: "x",
      [`${WEB}/.repo/subagents/a.md`]: "x",
      [`${WEB}/.repo/hooks.jsonc`]: "{}",
      [`${WEB}/.repo/rules/ok.md`]: "x",
    });
    expect(check(root, [], null, [], [WEB])).toStrictEqual([
      `${WEB}/.repo/hooks.jsonc: a package .repo holds only rules/ and skills/`,
      `${WEB}/.repo/lessons/: a package .repo holds only rules/ and skills/; lessons live in the root .repo`,
      `${WEB}/.repo/subagents/: a package .repo holds only rules/ and skills/; subagents live in the root .repo`,
    ]);
  });

  it("refuses a path that leaves the package, with or without git", () => {
    const rules = [pkgRule("x", "X.", ["../api/**"]), pkgRule("abs", "A.", ["/etc/**"])];
    const expected = [
      `${WEB}/.repo/rules/x.md: paths "../api/**" leaves the package; scope it inside ${WEB}`,
      `${WEB}/.repo/rules/abs.md: paths "/etc/**" leaves the package; scope it inside ${WEB}`,
    ];
    expect(inPkg(rules)).toStrictEqual(expected);
    expect(inPkg(rules, [`${WEB}/a.ts`])).toStrictEqual(expected);
  });

  it("matches a package glob under the package dir, not at the root", () => {
    const rules = [pkgRule("api", "Api.", ["src/api/**"])];
    expect(inPkg(rules, ["src/api/a.ts"])).toStrictEqual([
      `${WEB}/.repo/rules/api.md: paths "src/api/**" matches no file`,
    ]);
    expect(inPkg(rules, [`${WEB}/src/api/a.ts`])).toStrictEqual([]);
  });

  it("checks a package skill like a root one but refuses overrides", () => {
    const files = {
      [`${WEB}/.repo/skills/bad/SKILL.md`]: skill("other"),
      [`${WEB}/.repo/skills/ov/SKILL.md`]: `---\nname: ov\ndescription: d\noverrides: ov\n---\n`,
      [`${WEB}/.repo/skills/linky/SKILL.md`]: skill("linky", "d", "[x](nope.md)"),
    };
    expect(inPkg([], null, files)).toStrictEqual([
      `${WEB}/.repo/skills/bad/SKILL.md: name "other" must equal the folder name "bad"`,
      `${WEB}/.repo/skills/linky/SKILL.md: link nope.md does not exist`,
      `${WEB}/.repo/skills/ov/SKILL.md: overrides has no meaning in a package skill; remove it`,
    ]);
  });

  it("resolves a package rule's links from the package dir", () => {
    const root = repo({ [`${WEB}/docs/a.md`]: "x" });
    const rules = [pkgRule("l", "[ok](docs/a.md) [bad](docs/b.md)")];
    expect(check(root, rules, null, [], [WEB])).toStrictEqual([
      `${WEB}/.repo/rules/l.md: link docs/b.md does not exist`,
    ]);
  });

  it("puts no size budget on pathless rules, root or package; AGENTS.md text is the user's", () => {
    const big = "a".repeat(BIG_RULE_BYTES);
    expect(inPkg([pkgRule("big", big)])).toStrictEqual([]);
    expect(check(repo(), [rule("big", big)])).toStrictEqual([]);
  });
});
