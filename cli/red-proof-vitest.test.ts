import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, expect, it, vi } from "vitest";

import { removeTemps } from "./__fixtures__/remove-temps.ts";
import { runVitest } from "./red-proof-vitest.ts";

/** This repo's root, whose node_modules holds vitest. */
const REPO = path.resolve(import.meta.dirname, "..");

/** A PATH holding no node at all. */
const NO_NODE = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-red-proof-no-node-"));

afterAll(() => {
  removeTemps([NO_NODE]);
});

it("names node as missing when the node run finds no node on PATH", () => {
  vi.stubEnv("PATH", NO_NODE);
  expect(runVitest(["run"], REPO, { run: "node", timeoutMs: 10_000 })).toStrictEqual({
    code: 1,
    stderr: "repo ci: vitest.node.config.ts runs on node, but node is not on PATH; install node",
  });
});

it("says vitest does not resolve from a dir without it", () => {
  expect(runVitest(["run"], NO_NODE, { run: "main", timeoutMs: 10_000 })).toStrictEqual({
    code: 1,
    stderr: `cannot resolve vitest from ${NO_NODE}`,
  });
});
