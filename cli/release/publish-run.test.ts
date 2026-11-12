import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { removePlanted } from "../__fixtures__/planted-repo.ts";
import { publish, type Registry } from "../__fixtures__/publish-world.ts";
import { gitIn, NAME, world } from "../__fixtures__/release-world.ts";

afterEach(removePlanted);

const SPEC = `${NAME}@0.1.0`;

function newVersion(notServed = 0, offline = 0): Registry {
  return { exists: true, listed: false, notServed, offline };
}

/** A bun whose pack fails with "boom". */
function failingBun() {
  return { code: 1, stderr: "boom\n", stdout: "" };
}

const PACK_DIR = path.normalize("/tmp/repo-pack-x1");
const TGZ = path.join(PACK_DIR, "acme-app-0.1.0.tgz");

describe("repo release publish publishes", () => {
  it("a first publish from your machine through npm, under latest", async () => {
    const registry: Registry = { exists: false, listed: false, notServed: 0 };
    const got = await publish(world(), [SPEC], registry, { ci: false });
    expect(got).toMatchObject({
      bunCalls: [`pm pack --destination ${PACK_DIR} --quiet`],
      code: 0,
      err: "",
      npmCalls: [`publish ${TGZ} --access public --ignore-scripts`],
      out: `repo release publish: packed ${SPEC} · published under latest · tarball served\n`,
    });
  });

  it("a new version of a package already on npm, in CI", async () => {
    const got = await publish(world(), [SPEC], newVersion(), { ci: true });
    expect(got).toMatchObject({ code: 0, npmCalls: [`publish ${TGZ} --access public --ignore-scripts`] });
  });

  it("a prerelease under next", async () => {
    const pre = `${NAME}@0.2.0-rc.1`;
    const w = world({ "package.json": { name: NAME, version: "0.2.0-rc.1" } }, false);
    gitIn(w.work, "tag", "-a", pre, "-m", "t");
    const got = await publish(w, [pre], newVersion(), { ci: true });
    expect(got.out).toBe(`repo release publish: packed ${pre} · published under next · tarball served\n`);
    expect(got.npmCalls).toStrictEqual([
      `publish ${path.join(PACK_DIR, "acme-app-0.2.0-rc.1.tgz")} --access public --ignore-scripts --tag next`,
    ]);
  });
});

describe("repo release publish waits and reruns", () => {
  it("waits for the tarball after publishing", async () => {
    const got = await publish(world(), [SPEC], newVersion(1));
    expect(got).toMatchObject({ code: 0, sleeps: [10_000] });
  });

  it("keeps waiting through a network error", async () => {
    const got = await publish(world(), [SPEC], newVersion(0, 2));
    expect(got).toMatchObject({ code: 0, sleeps: [10_000, 10_000] });
  });

  it("counts an npm failure as published when the version is listed by then", async () => {
    const got = await publish(world(), [SPEC], newVersion(), { npm: { code: 1, lists: true } });
    expect(got).toMatchObject({
      code: 0,
      out: `repo release publish: packed ${SPEC} · published under latest · tarball served\n`,
    });
  });
});

describe("repo release publish refuses", () => {
  it("an npm failure that published nothing", async () => {
    const got = await publish(world(), [SPEC], newVersion(), { npm: { code: 1, lists: false } });
    expect(got).toMatchObject({
      code: 1,
      err: "repo release publish: npm publish exited 1 and npm does not list 0.1.0; its output is above\n",
      out: "",
    });
  });

  it("a tarball that npm never serves after publishing", async () => {
    const got = await publish(world(), [SPEC], newVersion(Number.MAX_SAFE_INTEGER));
    expect(got).toMatchObject({
      code: 1,
      err: `repo release publish: the tarball of ${SPEC} is not served after 15 minutes; rerun this job\n`,
    });
  });
});

describe("repo release publish refuses a bad pack", () => {
  it("a package that bun cannot pack", async () => {
    const got = await publish(world(), [SPEC], newVersion(), { bun: failingBun });
    expect(got).toMatchObject({ code: 1, err: "repo release publish: bun pm pack failed: boom\n", npmCalls: [] });
  });

  it("a tarball that holds another name or version than the tag", async () => {
    const got = await publish(world(), [SPEC], newVersion(), { packed: { name: NAME, version: "0.0.9" } });
    expect(got).toMatchObject({
      code: 1,
      err: `repo release publish: the tarball holds ${NAME}@0.0.9 but the tag is ${SPEC}; nothing was published\n`,
      npmCalls: [],
    });
  });
});
