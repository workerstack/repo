import { afterEach, describe, expect, it } from "vitest";
import { removePlanted } from "../fixtures/planted-repo.ts";
import { spawnRunner } from "../scripts/ci-wait-run.ts";
import type { Runner } from "../scripts/ci-wait.ts";
import { OLD, TIMEOUT } from "./fixtures/api-cases.ts";
import { api, apiRepo, NAME, oldTarball, PREFIX, REGISTRY, TAG } from "./fixtures/api-repo.ts";

afterEach(removePlanted);

/** A bun that installs `tarball` when asked for the registry version, as a registry would serve it. */
const served =
  (tarball: string): Runner =>
  (args, cwd) =>
    spawnRunner("bun")(args.includes("--registry") ? ["add", `old@${tarball}`] : args, cwd);

const OK = `${PREFIX}${NAME} 1.0.0 → this checkout · 2 code subpaths · 0 added, 0 widened, 0 breaking · feat commits: 2 · ok\n`;

describe("repo release api against the registry", () => {
  it("prints the nothing-to-compare line when the version has no tag", { timeout: TIMEOUT }, async () => {
    expect(await api(apiRepo(OLD, [], false), [])).toMatchObject({
      code: 0,
      out: `${PREFIX}no tag ${TAG} for the version in package.json; nothing to compare\n`,
      err: "",
    });
  });

  it("installs the tagged version from the registry and counts the feat commits", { timeout: TIMEOUT }, async () => {
    const dir = apiRepo(OLD, ["feat: a", "fix: b", "feat: c"]);
    const got = await api(dir, [], { bun: served(oldTarball(OLD)) });
    expect(got).toMatchObject({ code: 0, out: OK });
  });

  it(
    "names the registry and bun's first error line when the old version will not install",
    { timeout: TIMEOUT },
    async () => {
      const bun: Runner = (args, cwd) =>
        args.includes("--registry")
          ? { code: 1, stdout: "", stderr: "error: 404 not found\nmore\n" }
          : spawnRunner("bun")(args, cwd);
      const got = await api(apiRepo(OLD, []), [], { bun });
      expect(got).toMatchObject({
        code: 1,
        out: "",
        err: `${PREFIX}could not install ${NAME}@1.0.0 from ${REGISTRY}: error: 404 not found\n`,
      });
    },
  );
});
