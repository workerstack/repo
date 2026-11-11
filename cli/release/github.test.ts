import { afterEach, describe, expect, it } from "vitest";

import { removePlanted, tempDir, write } from "../fixtures/planted-repo.ts";
import type { Runner } from "../scripts/ci-wait.ts";
import { releaseGithub } from "./github.ts";

afterEach(removePlanted);

const CHANGELOG = `# Changelog

## [Unreleased]

## [0.2.0-rc.1] - 2026-11-09

### Added

- a thing

### Fixed

- another

## [0.1.0] - 2026-10-01

### Added

- first
`;
const TAG = "@acme/app@0.1.0";
const NOTES = "### Added\n\n- first";
const FORMAT = "repo release github: name the tag as <name>@<version>, e.g. @workerstack/repo@1.0.0\n";

/** A gh whose `release view` finds the release when `exists` is true, or once `create` ran when it is "after-create". */
function fakeGh(exists: boolean | "after-create", created = 0): { gh: Runner; calls: string[] } {
  const calls: string[] = [];
  let made = false;
  const gh: Runner = (args) => {
    calls.push(args.join(" "));
    if (args[1] === "view") {
      const found = exists === true || (exists === "after-create" && made);
      return { code: found ? 0 : 1, stderr: "", stdout: "" };
    }
    made = true;
    return { code: created, stderr: created === 0 ? "" : "denied", stdout: "" };
  };
  return { calls, gh };
}

async function github(argv: string[], gh: Runner, changelog: string | null = CHANGELOG) {
  const dir = tempDir();
  if (changelog !== null) write(dir, { "CHANGELOG.md": changelog });
  const out: string[] = [];
  const err: string[] = [];
  const code = await releaseGithub(argv, { cwd: dir, gh, stderr: (s) => err.push(s), stdout: (s) => out.push(s) });
  return { code, err: err.join(""), out: out.join("") };
}

describe("repo release github", () => {
  it("creates the release from the changelog section of the version", async () => {
    const { gh, calls } = fakeGh(false);
    expect(await github([TAG], gh)).toStrictEqual({
      code: 0,
      err: "",
      out: `repo release github: created release ${TAG} from CHANGELOG.md\n`,
    });
    expect(calls).toStrictEqual([
      `release view ${TAG}`,
      `release create ${TAG} --verify-tag --title ${TAG} --notes ${NOTES}`,
    ]);
  });

  it("marks a prerelease", async () => {
    const tag = "@acme/app@0.2.0-rc.1";
    const { gh, calls } = fakeGh(false);
    await github([tag], gh);
    const notes = "### Added\n\n- a thing\n\n### Fixed\n\n- another";
    expect(calls[1]).toBe(`release create ${tag} --verify-tag --title ${tag} --notes ${notes} --prerelease`);
  });
});

describe("repo release github reruns", () => {
  it("leaves a release that exists alone", async () => {
    const { gh, calls } = fakeGh(true);
    expect(await github([TAG], gh)).toStrictEqual({
      code: 0,
      err: "",
      out: `repo release github: release ${TAG} already exists\n`,
    });
    expect(calls).toStrictEqual([`release view ${TAG}`]);
  });

  it("counts a failed create as done when the release exists by then", async () => {
    const { gh } = fakeGh("after-create", 1);
    expect(await github([TAG], gh)).toMatchObject({
      code: 0,
      out: `repo release github: release ${TAG} already exists\n`,
    });
  });
});

describe("repo release github refuses", () => {
  it("a failed create with gh's reason", async () => {
    const { gh } = fakeGh(false, 1);
    expect(await github([TAG], gh)).toStrictEqual({
      code: 1,
      err: "repo release github: gh release create failed: denied\n",
      out: "",
    });
  });

  it("a changelog without the version's section", async () => {
    const { gh, calls } = fakeGh(false);
    expect(await github(["@acme/app@9.9.9"], gh)).toStrictEqual({
      code: 1,
      err: "repo release github: CHANGELOG.md has no ## [9.9.9] section to make the notes from\n",
      out: "",
    });
    expect(calls).toStrictEqual([]);
  });

  it("a missing changelog the same way", async () => {
    expect((await github([TAG], fakeGh(false).gh, null)).code).toBe(1);
  });

  it("a missing or malformed argument with the tag format", async () => {
    expect((await github([], fakeGh(false).gh)).err).toBe(FORMAT);
    expect((await github(["x"], fakeGh(false).gh)).err).toBe(FORMAT);
  });
});
