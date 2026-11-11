import { afterEach, expect, it } from "vitest";
import { cleanup, world } from "./fixtures/update-world.ts";
import { main } from "./update.ts";

afterEach(cleanup);

const REPO = "@workerstack/repo";
const REFS = "@workerstack/references";
const NM = ["node", "modules"].join("_");
const at = (dir: string, name: string, file: string): string => [dir, NM, name, file].filter(Boolean).join("/");
const manifest = (name: string, version: string): string => `${JSON.stringify({ name, version })}\n`;
const LOG = `# Changelog

## [Unreleased]

- not out yet

## [0.3.0] - 2026-12-01

### Added

- too new

## [0.2.0] - 2026-11-20

### Changed

- the bump

## [0.1.3] - 2026-11-10

### Fixed

- already installed

## [0.1.2] - 2026-11-05

- older
`;

it("prints the sections above the installed version up to the new one, newest first", async () => {
  const files = { "package.json": { name: "r", dependencies: { [REPO]: "^0.1.0" } } };
  const disk = {
    installed: { [at("", REPO, "package.json")]: manifest(REPO, "0.1.3") },
    writes: { [at("", REPO, "package.json")]: manifest(REPO, "0.2.0"), [at("", REPO, "CHANGELOG.md")]: LOG },
  };
  const w = world(files, { [REPO]: "0.2.0" }, disk);
  expect(await main([], w.io())).toBe(0);
  expect(w.out).toEqual([
    "updated 1: @workerstack/repo ^0.1.0 → ^0.2.0 in package.json",
    "@workerstack/repo 0.1.3 → 0.2.0:",
    "  ## [0.2.0] - 2026-11-20",
    "  ### Changed",
    "  - the bump",
  ]);
});

it("starts from the lowest spec version when nothing is installed", async () => {
  const files = {
    "package.json": { name: "r", workspaces: ["packages/*"], dependencies: { [REPO]: "^0.1.2" } },
    "packages/api/package.json": { name: "api", dependencies: { [REPO]: "0.1.0" } },
  };
  const disk = { writes: { [at("", REPO, "CHANGELOG.md")]: LOG } };
  const w = world(files, { [REPO]: "0.2.0" }, disk);
  expect(await main([], w.io())).toBe(0);
  expect(w.out.slice(1)).toEqual([
    "@workerstack/repo 0.1.0 → 0.2.0:",
    "  ## [0.2.0] - 2026-11-20",
    "  ### Changed",
    "  - the bump",
    "  ## [0.1.3] - 2026-11-10",
    "  ### Fixed",
    "  - already installed",
    "  ## [0.1.2] - 2026-11-05",
    "  - older",
  ]);
});

it("reads the installed version and the changelog from the member that holds the package", async () => {
  const files = {
    "package.json": { name: "r", workspaces: ["packages/*"] },
    "packages/a/package.json": { name: "a", dependencies: { [REPO]: "^0.1.0" } },
    "packages/b/package.json": { name: "b", dependencies: { [REPO]: "^0.1.0" } },
  };
  const dir = "packages/b";
  const disk = {
    installed: { [at(dir, REPO, "package.json")]: manifest(REPO, "0.1.2") },
    writes: { [at(dir, REPO, "CHANGELOG.md")]: LOG, [at("", REPO, "CHANGELOG.md")]: "## [0.2.0] - x\n\n- wrong dir\n" },
  };
  const w = world(files, { [REPO]: "0.2.0" }, disk);
  expect(await main([], w.io())).toBe(0);
  expect(w.out.slice(1)).toEqual([
    "@workerstack/repo 0.1.2 → 0.2.0:",
    "  ## [0.2.0] - 2026-11-20",
    "  ### Changed",
    "  - the bump",
    "  ## [0.1.3] - 2026-11-10",
    "  ### Fixed",
    "  - already installed",
  ]);
});

it("prints no block for a package outside @workerstack", async () => {
  const files = { "package.json": { name: "r", dependencies: { "@other/repo": "1.0.0", zod: "1.0.0" } } };
  const disk = { writes: { [at("", "@other/repo", "CHANGELOG.md")]: LOG } };
  const w = world(files, { "@other/repo": "2.0.0", zod: "2.0.0" }, disk);
  expect(await main([], w.io())).toBe(0);
  expect(w.out).toHaveLength(1);
});

it("says in one line that a package ships no CHANGELOG.md", async () => {
  const files = {
    "package.json": { name: "r", workspaces: ["packages/*"] },
    "packages/a/package.json": { name: "a", dependencies: { [REFS]: "0.1.1" } },
  };
  const disk = { installed: { [at("packages/a", REFS, "package.json")]: manifest(REFS, "0.1.1") } };
  const w = world(files, { [REFS]: "0.1.2" }, disk);
  expect(await main([], w.io())).toBe(0);
  expect(w.out.slice(1)).toEqual([
    `@workerstack/references 0.1.1 → 0.1.2: no CHANGELOG.md in ${at("packages/a", REFS, "").replace(/\/$/, "")}`,
  ]);
});

it("says so when the changelog has nothing between the versions", async () => {
  const files = { "package.json": { name: "r", dependencies: { [REPO]: "0.1.3" } } };
  const w = world(files, { [REPO]: "0.1.4" }, { writes: { [at("", REPO, "CHANGELOG.md")]: LOG } });
  expect(await main([], w.io())).toBe(0);
  expect(w.out.slice(1)).toEqual(["@workerstack/repo 0.1.3 → 0.1.4: no CHANGELOG.md sections between them"]);
});

it("prints no block when the install fails", async () => {
  const files = { "package.json": { name: "r", dependencies: { [REPO]: "^0.1.0" } } };
  const w = world(files, { [REPO]: "0.2.0" }, { writes: { [at("", REPO, "CHANGELOG.md")]: LOG } });
  expect(await main([], w.io({ install: () => ({ code: 1, output: "boom\n" }) }))).toBe(1);
  expect(w.out).toEqual(["updated 1: @workerstack/repo ^0.1.0 → ^0.2.0 in package.json"]);
});
