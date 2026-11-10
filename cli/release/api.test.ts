import { afterEach, describe, expect, it } from "vitest";
import { removePlanted } from "../fixtures/planted-repo.ts";
import {
  addition,
  FEAT_TAIL,
  OLD,
  removal,
  REMOVAL_LINES,
  REMOVAL_OK,
  TIMEOUT,
  withOld,
} from "./fixtures/api-cases.ts";
import { api, apiRepo, PREFIX } from "./fixtures/api-repo.ts";

afterEach(removePlanted);

const AGAINST = ["--against", "old.tgz"];

describe("repo release api removals and narrowings", () => {
  it(
    "refuses a removed name, a removed subpath and a narrowed name with no breaking commit",
    { timeout: TIMEOUT },
    () => {
      const got = api(removal("refactor: drop them"), AGAINST);
      expect(got).toMatchObject({ code: 1, out: "", err: REMOVAL_LINES });
    },
  );

  it("passes them behind a commit marked with !", { timeout: TIMEOUT }, () => {
    const got = api(removal("refactor!: drop them"), AGAINST);
    expect(got).toMatchObject({ code: 0, out: REMOVAL_OK, err: "" });
  });

  it("passes them behind a BREAKING CHANGE footer", { timeout: TIMEOUT }, () => {
    const got = api(removal("refactor: drop them\n\nBREAKING CHANGE: they are gone"), AGAINST);
    expect(got).toMatchObject({ code: 0, out: REMOVAL_OK, err: "" });
  });

  it("reads every commit when the repo has no tag", { timeout: TIMEOUT }, () => {
    const dir = withOld(
      apiRepo(
        { index: "export declare const keep: string;\nexport declare const narrow: string | number;\n" },
        ["refactor!: drop them"],
        false,
      ),
    );
    expect(api(dir, AGAINST)).toMatchObject({ code: 0, out: REMOVAL_OK });
  });
});

const FEAT_LINE = `${PREFIX}"./y" and \`fresh\` in "." are new or widened since old.tgz${FEAT_TAIL}`;
const ADDED_OK = `${PREFIX}old.tgz → this checkout · 3 code subpaths · 2 added, 0 widened, 0 breaking · ok\n`;

describe("repo release api additions", () => {
  it("refuses an added name and subpath with no feat commit", { timeout: TIMEOUT }, () => {
    expect(api(addition("fix: tidy"), AGAINST)).toMatchObject({ code: 1, out: "", err: FEAT_LINE });
  });

  it("passes them behind a feat commit and behind a breaking commit", { timeout: TIMEOUT }, () => {
    expect(api(addition("feat: more"), AGAINST)).toMatchObject({ code: 0, out: ADDED_OK, err: "" });
    expect(api(addition("fix!: more"), AGAINST)).toMatchObject({ code: 0, out: ADDED_OK, err: "" });
  });

  it("names a lone new subpath, and counts several new names", { timeout: TIMEOUT }, () => {
    const subpath = withOld(apiRepo({ ...OLD, y: OLD.x }, ["fix: tidy"]));
    expect(api(subpath, AGAINST).err).toBe(`${PREFIX}"./y" is new or widened since old.tgz${FEAT_TAIL}`);
    const index = `${OLD.index}export declare const f1: number;\nexport declare const f2: number;\n`;
    const names = withOld(apiRepo({ ...OLD, index }, ["fix: z"]));
    expect(api(names, AGAINST).err).toBe(`${PREFIX}2 names are new or widened since old.tgz${FEAT_TAIL}`);
  });
});
