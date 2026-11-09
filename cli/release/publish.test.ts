import { afterEach, describe, expect, it } from "vitest";
import { publish, type Registry } from "../fixtures/publish-world.ts";
import { removePlanted, tempDir } from "../fixtures/planted-repo.ts";
import { commit, gitIn, NAME, world } from "../fixtures/release-world.ts";

afterEach(removePlanted);

const SPEC = `${NAME}@0.1.0`;
const GONE: Registry = { exists: false, listed: false, notServed: 0 };
const LISTED = (notServed = 0): Registry => ({ exists: true, listed: true, notServed });
const TARBALL = "https://registry.npmjs.org/@acme/app/-/app-0.1.0.tgz";
const TAG_FORMAT = "repo release publish: name the tag as <name>@<version>, e.g. @workerstack/repo@1.0.0\n";

describe("repo release publish starts from the tag", () => {
  it("refuses when HEAD is past the tag, without packing or publishing", async () => {
    const w = world();
    commit(w, "chore: later", { "later.txt": "x\n" });
    const got = await publish(w, [SPEC], LISTED());
    expect(got).toMatchObject({
      code: 1,
      out: "",
      err: `repo release publish: HEAD is not ${SPEC}; check out the tag first\n`,
      npmCalls: [],
      bunCalls: [],
    });
  });

  it("refuses a tag that does not exist", async () => {
    expect((await publish(world({}, false), [SPEC], LISTED())).err).toBe(
      `repo release publish: HEAD is not ${SPEC}; check out the tag first\n`,
    );
  });

  it("refuses outside a git checkout", async () => {
    const got = await publish({ work: tempDir(), remote: "" }, [SPEC], LISTED());
    expect(got.err).toBe(`repo release publish: HEAD is not ${SPEC}; check out the tag first\n`);
  });

  it("refuses a missing or malformed argument with the tag format", async () => {
    expect((await publish(world(), [], LISTED())).err).toBe(TAG_FORMAT);
    expect((await publish(world(), ["x"], LISTED())).err).toBe(TAG_FORMAT);
  });
});

describe("repo release publish skips a version npm serves", () => {
  it("says so and runs nothing", async () => {
    const got = await publish(world(), [SPEC], LISTED());
    expect(got).toMatchObject({
      code: 0,
      out: `repo release publish: ${SPEC} is already on npm; nothing to publish\n`,
      err: "",
      npmCalls: [],
      bunCalls: [],
      urls: ["https://registry.npmjs.org/@acme%2fapp", TARBALL],
    });
  });

  it("polls the tarball url every 10 seconds when npm lists the version but does not serve it yet", async () => {
    const got = await publish(world(), [SPEC], LISTED(2));
    expect(got).toMatchObject({ code: 0, sleeps: [10_000, 10_000], npmCalls: [] });
    expect(got.out).toBe(
      "repo release publish: npm lists 0.1.0 but its tarball is not served yet; waiting…\n" +
        `repo release publish: ${SPEC} is already on npm; nothing to publish\n`,
    );
    expect(got.urls.filter((url) => url === TARBALL)).toHaveLength(3);
  });

  it("gives up after 15 minutes", async () => {
    const got = await publish(world(), [SPEC], LISTED(Number.MAX_SAFE_INTEGER));
    expect(got.code).toBe(1);
    expect(got.err).toBe(
      `repo release publish: the tarball of ${SPEC} is not served after 15 minutes; rerun this job\n`,
    );
    expect(got.sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(900_000);
  });
});

describe("repo release publish for a package that is not on npm", () => {
  const origin = (url: string) => {
    const w = world();
    gitIn(w.work, "remote", "set-url", "origin", url);
    return publish(w, [SPEC], { ...GONE }, { ci: true });
  };
  const bootstrap = (repo: string) =>
    `repo release publish: ${NAME} is not on npm yet, and npm adds a trusted publisher only to a package that exists;\n` +
    `  run \`npm login\` and \`bun repo release publish ${SPEC}\` at that tag on your machine, then add the\n` +
    `  trusted publisher at https://www.npmjs.com/package/${NAME}/access (GitHub Actions, ${repo}, release.yml)\n`;

  it("prints the bootstrap steps in CI and publishes nothing", async () => {
    const got = await origin("https://github.com/acme/app.git");
    expect(got).toMatchObject({ code: 1, out: "", err: bootstrap("acme/app"), npmCalls: [], bunCalls: [] });
  });

  it("names the repository from an ssh remote too", async () => {
    expect((await origin("git@github.com:acme/app.git")).err).toBe(bootstrap("acme/app"));
  });

  it("names the repository from a remote with no .git", async () => {
    expect((await origin("https://github.com/acme/app")).err).toBe(bootstrap("acme/app"));
  });

  it("leaves a placeholder for a remote that is not on GitHub", async () => {
    expect((await origin("/some/where.git")).err).toBe(bootstrap("<owner>/<repo>"));
  });
});

describe("repo release publish when the registry does not answer", () => {
  it("asks again every 10 seconds and goes on once it answers", async () => {
    const got = await publish(world(), [SPEC], { ...LISTED(), docFails: 2 });
    expect(got).toMatchObject({
      code: 0,
      out: `repo release publish: ${SPEC} is already on npm; nothing to publish\n`,
      sleeps: [10_000, 10_000],
    });
  });

  it("does not print the bootstrap steps for a registry that is down, and gives up after 15 minutes", async () => {
    const got = await publish(world(), [SPEC], { ...GONE, docFails: Number.MAX_SAFE_INTEGER }, { ci: true });
    expect(got).toMatchObject({
      code: 1,
      out: "",
      err: "repo release publish: registry.npmjs.org did not answer for 15 minutes (HTTP 503); rerun the release job\n",
      npmCalls: [],
    });
    expect(got.sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(900_000);
  });
});
