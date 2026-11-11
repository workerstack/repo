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
    async () => {
      const got = await api(removal("refactor: drop them"), AGAINST);
      expect(got).toMatchObject({ code: 1, err: REMOVAL_LINES, out: "" });
    },
  );

  it("passes them behind a commit marked with !", { timeout: TIMEOUT }, async () => {
    const got = await api(removal("refactor!: drop them"), AGAINST);
    expect(got).toMatchObject({ code: 0, err: "", out: REMOVAL_OK });
  });

  it("passes them behind a BREAKING CHANGE footer", { timeout: TIMEOUT }, async () => {
    const got = await api(removal("refactor: drop them\n\nBREAKING CHANGE: they are gone"), AGAINST);
    expect(got).toMatchObject({ code: 0, err: "", out: REMOVAL_OK });
  });

  it("reads every commit when the repo has no tag", { timeout: TIMEOUT }, async () => {
    const dir = withOld(
      apiRepo(
        { index: "export declare const keep: string;\nexport declare const narrow: string | number;\n" },
        ["refactor!: drop them"],
        false,
      ),
    );
    expect(await api(dir, AGAINST)).toMatchObject({ code: 0, out: REMOVAL_OK });
  });
});

const FEAT_LINE = `${PREFIX}"./y" and \`fresh\` in "." are new or widened since old.tgz${FEAT_TAIL}`;
const ADDED_OK = `${PREFIX}old.tgz → this checkout · 3 code subpaths · 2 added, 0 widened, 0 breaking · ok\n`;

describe("repo release api additions", () => {
  it("refuses an added name and subpath with no feat commit", { timeout: TIMEOUT }, async () => {
    expect(await api(addition("fix: tidy"), AGAINST)).toMatchObject({ code: 1, err: FEAT_LINE, out: "" });
  });

  it("passes them behind a feat commit and behind a breaking commit", { timeout: TIMEOUT }, async () => {
    expect(await api(addition("feat: more"), AGAINST)).toMatchObject({ code: 0, err: "", out: ADDED_OK });
    expect(await api(addition("fix!: more"), AGAINST)).toMatchObject({ code: 0, err: "", out: ADDED_OK });
  });

  it("names a lone new subpath, and counts several new names", { timeout: TIMEOUT }, async () => {
    const subpath = withOld(apiRepo({ ...OLD, y: OLD.x }, ["fix: tidy"]));
    expect((await api(subpath, AGAINST)).err).toBe(`${PREFIX}"./y" is new or widened since old.tgz${FEAT_TAIL}`);
    const index = `${OLD.index}export declare const f1: number;\nexport declare const f2: number;\n`;
    const names = withOld(apiRepo({ ...OLD, index }, ["fix: z"]));
    expect((await api(names, AGAINST)).err).toBe(`${PREFIX}2 names are new or widened since old.tgz${FEAT_TAIL}`);
  });
});
