import { expect, it } from "vitest";

import { BIG_RULE_BYTES, WEB, check, inPkg, pkgRule, repo, rule, skill } from "./fixtures/repo-dir-kit.ts";
import { useTempDirs } from "./fixtures/temp-dirs.ts";

useTempDirs();

it("passes rules and skills, a pathless rule, and a path rule that matches a file under the package", () => {
  const root = repo({
    [`${WEB}/.repo/rules/api.md`]: "x",
    [`${WEB}/.repo/skills/deploy/SKILL.md`]: skill("deploy", "ships it"),
  });
  const rules = [pkgRule("api", "Api.", { paths: ["src/api/**"] }), pkgRule("all", "All.")];
  expect(check(root, rules, { listed: [`${WEB}/src/api/a.ts`], packages: [WEB] })).toStrictEqual([]);
});

it("refuses every entry but rules/ and skills/, subagents and lessons with where they live", () => {
  const root = repo({
    [`${WEB}/.repo/lessons/INDEX.md`]: "x",
    [`${WEB}/.repo/subagents/a.md`]: "x",
    [`${WEB}/.repo/hooks.jsonc`]: "{}",
    [`${WEB}/.repo/rules/ok.md`]: "x",
  });
  expect(check(root, [], { packages: [WEB] })).toStrictEqual([
    `${WEB}/.repo/hooks.jsonc: a package .repo holds only rules/ and skills/`,
    `${WEB}/.repo/lessons/: a package .repo holds only rules/ and skills/; lessons live in the root .repo`,
    `${WEB}/.repo/subagents/: a package .repo holds only rules/ and skills/; subagents live in the root .repo`,
  ]);
});

it("refuses a path that leaves the package, with or without git", () => {
  const rules = [pkgRule("x", "X.", { paths: ["../api/**"] }), pkgRule("abs", "A.", { paths: ["/etc/**"] })];
  const expected = [
    `${WEB}/.repo/rules/x.md: paths "../api/**" leaves the package; scope it inside ${WEB}`,
    `${WEB}/.repo/rules/abs.md: paths "/etc/**" leaves the package; scope it inside ${WEB}`,
  ];
  expect(inPkg(rules)).toStrictEqual(expected);
  expect(inPkg(rules, [`${WEB}/a.ts`])).toStrictEqual(expected);
});

it("matches a package glob under the package dir, not at the root", () => {
  const rules = [pkgRule("api", "Api.", { paths: ["src/api/**"] })];
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
  expect(check(root, rules, { packages: [WEB] })).toStrictEqual([
    `${WEB}/.repo/rules/l.md: link docs/b.md does not exist`,
  ]);
});

it("puts no size budget on pathless rules, root or package; AGENTS.md text is the user's", () => {
  const big = "a".repeat(BIG_RULE_BYTES);
  expect(inPkg([pkgRule("big", big)])).toStrictEqual([]);
  expect(check(repo(), [rule("big", big)])).toStrictEqual([]);
});
