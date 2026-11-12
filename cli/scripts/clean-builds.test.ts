import type fs from "node:fs";

import { expect, it } from "vitest";

import { build, buildRepo, cleanDirs, exists } from "./__fixtures__/clean-kit.ts";
import { size } from "./clean-run.ts";

const tempDir = cleanDirs();

it(
  "repo clean --build removes the ignored caches and tsbuildinfo, " +
    "prints the counts and size, and leaves the sweep's dir alone",
  () => {
    const root = buildRepo(tempDir);
    expect(build(root)).toStrictEqual({ code: 0, lines: ["removed 2 build dirs and 1 tsbuildinfo file (6 B)"] });
    expect(exists(root)(".next")).toBe(false);

    for (const kept of ["node_modules/m/i", ".flare/s", ".tmp/repo/old.log", "src/a.ts"])
      expect(exists(root)(kept)).toBe(true);
  },
);

it("repo clean --build takes the dir names the config adds", () => {
  const root = buildRepo(tempDir);
  expect(build(root, { names: [".flare"] }).lines).toStrictEqual(["removed 3 build dirs and 1 tsbuildinfo file (7 B)"]);
});

it("repo clean --build says why a path it cannot remove was skipped, and exits 1", () => {
  const busy = (() => {
    throw Object.assign(new Error("busy"), { code: "EBUSY" });
  }) /* the stand-in takes the path and options the report passes */ as typeof fs.rmSync;

  const second = build(buildRepo(tempDir), { rm: busy });
  expect(second.code).toBe(1);
  expect(second.lines).toContain("skipped .next: EBUSY");
  expect(second.lines.at(-1)).toBe("removed 0 build dirs");
});

it("repo clean --build refuses outside a git repo", () => {
  const { code, lines } = build(tempDir("repo-clean-plain-"));
  expect(code).toBe(1);
  expect(lines[0]).toMatch(/^repo clean: git ls-files failed: /);
});

it("repo clean --deps --dry-run lists the paths, counts node_modules too, removes nothing, and says to install", () => {
  const root = buildRepo(tempDir);
  const { code, lines } = build(root, { deps: true, dryRun: true });
  expect(code).toBe(0);
  expect(lines.slice(0, -1).toSorted()).toStrictEqual([".next", "apps/.turbo", "node_modules", "x.tsbuildinfo"]);
  expect(lines.at(-1)).toBe(
    "would remove 2 build dirs, 1 tsbuildinfo file and 1 node_modules (10 B); then run `bun install`",
  );
  expect(exists(root)("node_modules/m/i")).toBe(true);
});

it("repo clean --deps removes node_modules, and a second run finds nothing", () => {
  const root = buildRepo(tempDir);
  expect(build(root, { deps: true }).lines.at(-1)).toMatch(
    /^removed 2 build dirs, .* and 1 node_modules \(10 B\); then run/,
  );
  expect(exists(root)("node_modules")).toBe(false);
  expect(build(root, { deps: true }).lines).toStrictEqual(["removed 0 build dirs"]);
  expect(build(root, { deps: true, dryRun: true }).lines).toStrictEqual(["would remove 0 build dirs"]);
});

it("size prints GB from 1024 MB", () => {
  const mb = 1024 * 1024;
  expect([size(1023 * mb), size(1024 * mb), size(1536 * mb), size(2.9 * 1024 * mb)]).toStrictEqual([
    "1023.0 MB",
    "1.0 GB",
    "1.5 GB",
    "2.9 GB",
  ]);
});
