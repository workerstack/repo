import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { removeTemps } from "../__fixtures__/remove-temps.ts";
import { useTempTree } from "../__fixtures__/temp-tree.ts";
import { packageBin } from "./package-bin.ts";
import { BINS, vitestBin } from "./turn.ts";

/** This repo's root, whose node_modules holds vitest. */
const REPO = path.resolve(import.meta.dirname, "../..");
const VITEST = packageBin(Bun.resolveSync("vitest/package.json", REPO), "vitest");
const SLOW = 60_000;

/** A PATH whose `node` prints its arguments instead of running them, so a test sees what node was handed. */
const FAKE_NODE = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-fake-node-"));

fs.writeFileSync(path.join(FAKE_NODE, "node"), '#!/bin/sh\necho "fake-node $*"\n', { mode: 0o755 });

/** A PATH holding no node at all. */
const NO_NODE = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-no-node-"));

afterAll(() => {
  removeTemps([FAKE_NODE, NO_NODE]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const tree = useTempTree("workerstack-turn-node-");

/**
 * A workspace root declaring `root` and `api` as engines.node ranges, plus the `extra` files, with this repo's vitest
 * installed.
 */
function workspace(root: Record<string, string>, api: Record<string, string>, extra: Record<string, string> = {}) {
  const dir = tree({
    "package.json": JSON.stringify({ engines: root, name: "app", workspaces: ["packages/*"] }),
    "packages/api/package.json": JSON.stringify({ engines: api, name: "api" }),
    ...extra,
  });

  fs.symlinkSync(path.join(REPO, "node_modules"), path.join(dir, "node_modules"), "junction");

  return dir;
}

describe("vitestBin", () => {
  it.skipIf(process.platform === "win32")(
    "spawns node on the vitest bin with the nested flags when a range is set",
    async () => {
      vi.stubEnv("PATH", FAKE_NODE);
      expect(await vitestBin({ dev: undefined, engines: ">=22" })(["run", "a.test.ts"], REPO, "main")).toStrictEqual({
        code: 0,
        stderr: "",
        stdout: `fake-node ${VITEST} --fsModuleCache=false run a.test.ts\n`,
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "keeps bun when no range is set, with node on PATH",
    { timeout: SLOW },
    async () => {
      vi.stubEnv("PATH", FAKE_NODE);
      const run = await vitestBin({ dev: undefined, engines: undefined })(["--version"], REPO, "main");
      expect(run?.code).toBe(0);
      expect(run?.stdout).toContain("vitest/");
      expect(run?.stdout).not.toContain("fake-node");
    },
  );

  it("fails with the install hint when a range is set and node is not on PATH", async () => {
    vi.stubEnv("PATH", NO_NODE);
    const run = await vitestBin({ dev: undefined, engines: ">=22" })(["run"], REPO, "main");
    expect(run?.code).toBe(1);
    expect(run?.stderr).toContain("repo ci: engines.node is set (>=22) but node is not on PATH; install node >=22");
  });
});

describe("the node run", () => {
  it.skipIf(process.platform === "win32")(
    "spawns node on the vitest bin with the node config, though no engines.node range is set",
    async () => {
      vi.stubEnv("PATH", FAKE_NODE);
      expect(await vitestBin({ dev: ">=22.12.0", engines: undefined })(["run"], REPO, "node")).toStrictEqual({
        code: 0,
        stderr: "",
        stdout: `fake-node ${VITEST} --fsModuleCache=false -c vitest.node.config.ts run\n`,
      });
    },
  );

  it("fails with the install hint naming the devEngines range when node is not on PATH", async () => {
    vi.stubEnv("PATH", NO_NODE);
    const run = await vitestBin({ dev: ">=22.12.0", engines: undefined })(["run"], REPO, "node");
    expect(run?.code).toBe(1);
    expect(run?.stderr).toContain(
      "repo ci: vitest.node.config.ts runs on node, but node is not on PATH; install node >=22.12.0",
    );
  });
});

/** A manifest's devEngines naming node at `version`. */
function dev(version: string) {
  return { devEngines: { runtime: { name: "node", version } } };
}

describe("the node run's range", () => {
  it("names the engines.node range in the install hint when no devEngines range is set", async () => {
    vi.stubEnv("PATH", NO_NODE);
    const run = await vitestBin({ dev: undefined, engines: ">=22" })(["run"], REPO, "node");
    expect(run?.stderr).toContain(
      "repo ci: vitest.node.config.ts runs on node, but node is not on PATH; install node >=22",
    );
  });

  it("refuses to run when the packages declare different devEngines node ranges", async () => {
    const api = { "packages/api/package.json": JSON.stringify({ ...dev(">=24"), name: "api" }) };

    const dir = tree({
      "package.json": JSON.stringify({ ...dev(">=22"), name: "app", workspaces: ["packages/*"] }),
      ...api,
    });

    expect(await BINS.vitest(["run"], dir, "node")).toStrictEqual({
      code: 1,
      stderr:
        "repo ci: devEngines.runtime differs across packages (. >=22, packages/api >=24); set one range in each\n",
      stdout: "",
    });
  });

  it.skipIf(process.platform === "win32")("BINS.vitest reads the devEngines range from the root", async () => {
    vi.stubEnv("PATH", NO_NODE);

    const dir = tree({ "package.json": JSON.stringify({ ...dev(">=22.12.0"), name: "app" }) });

    fs.symlinkSync(path.join(REPO, "node_modules"), path.join(dir, "node_modules"), "junction");
    const run = await BINS.vitest(["run"], dir, "node");
    expect(run?.stderr).toContain("install node >=22.12.0");
  });
});

describe("BINS.vitest reads the range from the workspace", () => {
  it.skipIf(process.platform === "win32").each<[string, Record<string, string>, Record<string, string>]>([
    ["the root", { node: ">=22" }, {}],
    ["a workspace package only", {}, { node: ">=22" }],
  ])("spawns node when %s declares engines.node", async (_, root, api) => {
    vi.stubEnv("PATH", FAKE_NODE);
    const run = await BINS.vitest(["run"], workspace(root, api), "main");
    expect(run?.stdout).toMatch(/^fake-node \S+ --fsModuleCache=false run\n$/);
  });

  it.skipIf(process.platform === "win32")(
    "spawns node in a package dir when its sibling root declares the range",
    async () => {
      vi.stubEnv("PATH", FAKE_NODE);
      const root = workspace({ node: ">=22" }, {}, { "repo.config.ts": "export default {};\n" });
      const run = await BINS.vitest(["run"], path.join(root, "packages/api"), "main");
      expect(run?.stdout).toMatch(/^fake-node \S+ --fsModuleCache=false run\n$/);
    },
  );
});

describe("BINS.vitest refuses a workspace sync would refuse", () => {
  it("refuses to run, as sync does, when a package's engines.node is not a range", async () => {
    const api = { "packages/api/package.json": JSON.stringify({ engines: { node: 22 }, name: "api" }) };
    const run = await BINS.vitest(["run"], workspace({}, {}, api), "main");
    expect(run?.code).toBe(1);
    expect(run?.stderr).toMatch(/^repo ci: packages\/api\/package\.json: .*engines\.node.*must be a version range\n$/);
  });

  it("refuses to run when the packages declare different ranges", async () => {
    expect(await BINS.vitest(["run"], workspace({ node: ">=22" }, { node: ">=20" }), "main")).toStrictEqual({
      code: 1,
      stderr: "repo ci: engines.node differs across packages (. >=22, packages/api >=20); set one range in each\n",
      stdout: "",
    });
  });
});
