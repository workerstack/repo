import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { fakeExec, fakeOnPhase, checkoutRoot, readPkg, stubPkgRoot, tmp, useInitKit } from "./fixtures/init-kit.ts";
import { init } from "./init.ts";
import { PACKAGE_NAME } from "./sync/package-name.constants.ts";

useInitKit();

it("over a copied consumer removes old default repo: scripts, keeps edited ones, copies nothing", () => {
  const dest = tmp("repo-copied-");
  fs.mkdirSync(path.join(dest, ".rulesync"));
  fs.writeFileSync(
    path.join(dest, "package.json"),
    JSON.stringify({
      devDependencies: { rulesync: "9", "smol-toml": "1" },
      name: "app",
      scripts: { "repo:clean": "repo clean && rm -rf dist", "repo:doctor": "bun ./.rulesync/scripts/doctor.ts" },
    }),
  );
  init(dest, { execFileSync: fakeExec(), pkgRoot: stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }) });
  expect(readPkg(dest).scripts).toEqual({
    postinstall: "repo sync --postinstall",
    "repo:clean": "repo clean && rm -rf dist",
  });
  expect(fs.readdirSync(dest).toSorted()).toEqual([".mcp.json", ".rulesync", "package.json", "workerstack.config.ts"]);
  expect(fs.readdirSync(path.join(dest, ".rulesync"))).toEqual([]);
});

it("--skip-globals only installs", () => {
  const dest = tmp("repo-skip-globals-");
  const exec = fakeExec();
  init(dest, { execFileSync: exec, pkgRoot: stubPkgRoot(), skipGlobals: true });
  expect(exec.mock.calls.map((c) => c[1])).toEqual([["rev-parse", "--is-inside-work-tree"], ["install"]]);
});

it("onPhase reports merge, install and yolo, each stopped before its exec", () => {
  const dest = tmp("repo-onphase-");
  const onPhase = fakeOnPhase();
  init(dest, { execFileSync: fakeExec(), onPhase, pkgRoot: stubPkgRoot() });
  expect(onPhase.mock.calls).toEqual([
    ["merge", "start"],
    ["merge", "stop"],
    ["install", "start"],
    ["install", "stop"],
    ["yolo", "start"],
    ["yolo", "stop"],
  ]);
});

it("omitted pkgRoot uses the built-in package root", () => {
  const dest = tmp("repo-realroot-");
  init(dest, { execFileSync: fakeExec() });
  expect(readPkg(dest).devDependencies[PACKAGE_NAME]).toBe(readPkg(checkoutRoot()).version);
  expect(fs.readdirSync(dest).toSorted()).toEqual([".mcp.json", "package.json", "workerstack.config.ts"]);
});

it("self init changes nothing and runs nothing", () => {
  const pkgRoot = stubPkgRoot({ name: "fixture-pkg", scripts: { test: "x" }, version: "1.2.3" });
  const before = fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8");
  const exec = fakeExec();
  const onPhase = fakeOnPhase();
  init(pkgRoot, { execFileSync: exec, onPhase, pkgRoot });
  expect(exec).not.toHaveBeenCalled();
  expect(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8")).toBe(before);
  expect(fs.readdirSync(pkgRoot)).toEqual(["package.json"]);
  expect(onPhase).not.toHaveBeenCalled();
});

it("with no options, init on this package changes nothing", () => {
  const pkgPath = path.join(checkoutRoot(), "package.json");
  const before = fs.readFileSync(pkgPath, "utf8");
  init(checkoutRoot());
  expect(fs.readFileSync(pkgPath, "utf8")).toBe(before);
});

it("omitted execFileSync uses the default; self never invokes it", () => {
  const pkgRoot = stubPkgRoot();
  expect(() => init(pkgRoot, { pkgRoot })).not.toThrow();
});
