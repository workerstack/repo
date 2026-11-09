import { afterEach, describe, expect, it } from "vitest";
import { ghFor, refused, runGate, tagRelease } from "../fixtures/gate-world.ts";
import { removePlanted } from "../fixtures/planted-repo.ts";
import { commit, gitIn, NAME, world } from "../fixtures/release-world.ts";

afterEach(removePlanted);

describe("repo release gate refuses a tag that disagrees with its commit", () => {
  it("whose version differs from package.json at its commit", async () => {
    const w = world({}, false);
    const short = tagRelease(w, { version: "0.1.5", tagVersion: "0.2.0" });
    expect(await runGate(w, [`${NAME}@0.2.0`])).toEqual(
      refused(
        `the tag says 0.2.0 but package.json at ${short} says 0.1.5; a tag is never moved, so release the next version`,
      ),
    );
  });

  it("whose package name differs from package.json at its commit", async () => {
    const w = world({}, false);
    const short = tagRelease(w, { version: "0.2.0" });
    gitIn(w.work, "tag", "-a", "@other/app@0.2.0", "-m", "t");
    expect(await runGate(w, ["@other/app@0.2.0"])).toEqual(
      refused(`the tag names @other/app but package.json at ${short} names ${NAME}`),
    );
  });
});

describe("repo release gate refuses a tag whose commit lacks what a release needs", () => {
  it("a version with no changelog section", async () => {
    const w = world({}, false);
    const short = tagRelease(w, { version: "0.2.0", changelog: false });
    expect(await runGate(w, [`${NAME}@0.2.0`])).toEqual(
      refused(`CHANGELOG.md at ${short} has no ## [0.2.0] section; publish is refused without one`),
    );
  });

  it("a package.json that is not a manifest", async () => {
    const w = world({}, false);
    commit(w, "chore: release", { "package.json": "{}\n" });
    gitIn(w.work, "tag", "-a", `${NAME}@0.2.0`, "-m", "t");
    const short = gitIn(w.work, "rev-parse", "--short=7", "HEAD");
    expect(await runGate(w, [`${NAME}@0.2.0`])).toEqual(refused(`package.json at ${short} needs a name and a version`));
  });
});

describe("repo release gate refuses a commit that is not on the default branch", () => {
  it("when gh names another branch", async () => {
    const w = world({}, false);
    const short = tagRelease(w, { version: "0.2.0" });
    expect(await runGate(w, [`${NAME}@0.2.0`], ghFor("trunk"))).toEqual(
      refused(`${short} is not on trunk; tag a commit on trunk after its CI passed`),
    );
  });

  it("when it was never pushed", async () => {
    const w = world({}, false);
    const short = tagRelease(w, { version: "0.2.0", push: false });
    expect(await runGate(w, [`${NAME}@0.2.0`])).toEqual(
      refused(`${short} is not on main; tag a commit on main after its CI passed`),
    );
  });

  it("when gh cannot name the default branch", async () => {
    const w = world({}, false);
    tagRelease(w, { version: "0.2.0" });
    expect(await runGate(w, [`${NAME}@0.2.0`], ghFor(null))).toEqual(
      refused("gh could not read the default branch (not found); check gh auth status"),
    );
  });
});

describe("repo release gate refuses its arguments", () => {
  it("a tag that does not exist", async () => {
    expect(await runGate(world({}, false), [`${NAME}@0.2.0`])).toEqual(
      refused(`the tag ${NAME}@0.2.0 does not exist here; fetch the tags`),
    );
  });

  it("a missing or malformed tag with the tag format", async () => {
    const line = "name the tag as <name>@<version>, e.g. @workerstack/repo@1.0.0";
    expect(await runGate(world(), [])).toEqual(refused(line));
    expect(await runGate(world(), ["x", "y"])).toEqual(refused(line));
  });
});
