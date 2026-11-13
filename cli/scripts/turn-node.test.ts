import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

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
  for (const dir of [FAKE_NODE, NO_NODE]) fs.rmSync(dir, { force: true, recursive: true });
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
    () => {
      vi.stubEnv("PATH", FAKE_NODE);
      expect(vitestBin(">=22")(["run", "a.test.ts"], REPO)).toStrictEqual({
        code: 0,
        stderr: "",
        stdout: `fake-node ${VITEST} --fsModuleCache=false run a.test.ts\n`,
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "keeps bun when no range is set, with node on PATH",
    { timeout: SLOW },
    () => {
      vi.stubEnv("PATH", FAKE_NODE);
      const run = vitestBin(undefined)(["--version"], REPO);
      expect(run?.code).toBe(0);
      expect(run?.stdout).toContain("vitest/");
      expect(run?.stdout).not.toContain("fake-node");
    },
  );

  it("fails with the install hint when a range is set and node is not on PATH", () => {
    vi.stubEnv("PATH", NO_NODE);
    const run = vitestBin(">=22")(["run"], REPO);
    expect(run?.code).toBe(1);
    expect(run?.stderr).toContain("repo ci: engines.node is set (>=22) but node is not on PATH; install node >=22");
  });
});

describe("BINS.vitest reads the range from the workspace", () => {
  it.skipIf(process.platform === "win32").each<[string, Record<string, string>, Record<string, string>]>([
    ["the root", { node: ">=22" }, {}],
    ["a workspace package only", {}, { node: ">=22" }],
  ])("spawns node when %s declares engines.node", (_, root, api) => {
    vi.stubEnv("PATH", FAKE_NODE);
    const run = BINS.vitest(["run"], workspace(root, api));
    expect(run?.stdout).toMatch(/^fake-node \S+ --fsModuleCache=false run\n$/);
  });

  it.skipIf(process.platform === "win32")(
    "spawns node in a package dir when its sibling root declares the range",
    () => {
      vi.stubEnv("PATH", FAKE_NODE);
      const root = workspace({ node: ">=22" }, {}, { "repo.config.ts": "export default {};\n" });
      const run = BINS.vitest(["run"], path.join(root, "packages/api"));
      expect(run?.stdout).toMatch(/^fake-node \S+ --fsModuleCache=false run\n$/);
    },
  );
});

describe("BINS.vitest refuses a workspace sync would refuse", () => {
  it("refuses to run, as sync does, when a package's engines.node is not a range", () => {
    const api = { "packages/api/package.json": JSON.stringify({ engines: { node: 22 }, name: "api" }) };
    const run = BINS.vitest(["run"], workspace({}, {}, api));
    expect(run?.code).toBe(1);
    expect(run?.stderr).toMatch(/^repo ci: packages\/api\/package\.json: .*engines\.node.*must be a version range\n$/);
  });

  it("refuses to run when the packages declare different ranges", () => {
    expect(BINS.vitest(["run"], workspace({ node: ">=22" }, { node: ">=20" }))).toStrictEqual({
      code: 1,
      stderr: "repo ci: engines.node differs across packages (. >=22, packages/api >=20); set one range in each\n",
      stdout: "",
    });
  });
});
