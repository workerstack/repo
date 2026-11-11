import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { readPkg, stubPkgRoot, tmp, useInitKit } from "./__fixtures__/init-kit.ts";
import { mergePackageJson } from "./init.ts";
import { placeDevDependency } from "./place-dev-dependency.ts";
import { PACKAGE_NAME } from "./sync/package-name.constants.ts";

useInitKit();
/** The postinstall a merge leaves when the repo's package.json held `existing`. */
function postinstallAfterMerge(existing?: string) {
  const dest = tmp("pj-postinstall-");
  const scripts = existing == null ? {} : { postinstall: existing };
  fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ name: "app", scripts }));
  mergePackageJson(dest, stubPkgRoot());
  return readPkg(dest).scripts.postinstall;
}

it("adds it when the repo has no postinstall", () => {
  expect(postinstallAfterMerge()).toBe("repo sync --postinstall");
});

it("runs it before a postinstall the repo already has", () => {
  expect(postinstallAfterMerge("husky")).toBe("repo sync --postinstall && husky");
});

it("leaves a postinstall that already runs repo sync alone, so re-init converges", () => {
  expect(postinstallAfterMerge("repo sync --postinstall && husky")).toBe("repo sync --postinstall && husky");
  expect(postinstallAfterMerge("husky && repo sync")).toBe("husky && repo sync");
});

it("early return when name is @workerstack/repo", () => {
  const dest = tmp("pj-self-");
  const raw = `${JSON.stringify({ name: "@workerstack/repo", scripts: { test: "x" } }, null, 2)}\n`;
  fs.writeFileSync(path.join(dest, "package.json"), raw);
  mergePackageJson(dest, stubPkgRoot());
  expect(fs.readFileSync(path.join(dest, "package.json"), "utf8")).toBe(raw);
});

it("moves @workerstack/repo from dependencies to devDependencies", () => {
  const dest = tmp("pj-repo-dep-");
  fs.writeFileSync(
    path.join(dest, "package.json"),
    JSON.stringify({ dependencies: { [PACKAGE_NAME]: "0.6.2", lodash: "4" }, name: "app" }),
  );
  mergePackageJson(dest, stubPkgRoot({ name: PACKAGE_NAME, version: "0.6.2" }));
  const out = readPkg(dest);
  expect(out.dependencies).toStrictEqual({ lodash: "4" });
  expect(out.devDependencies[PACKAGE_NAME]).toBe("0.6.2");
});

it("drops empty dependencies after moving repo", () => {
  const dest = tmp("pj-repo-onlydep-");
  fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ dependencies: { [PACKAGE_NAME]: "0.6.2" } }));
  mergePackageJson(dest, stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }));
  const out = readPkg(dest);
  expect(out.dependencies).toBeUndefined();
  expect(out.devDependencies[PACKAGE_NAME]).toBe("0.6.2");
});

it("adds missing repo as a devDependency from the running package version", () => {
  const dest = tmp("pj-repo-add-");
  fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ name: "app" }));
  mergePackageJson(dest, stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }));
  expect(readPkg(dest).devDependencies[PACKAGE_NAME]).toBe("0.7.0");
});

it("keeps an existing repo devDependency version", () => {
  const dest = tmp("pj-repo-keep-");
  fs.writeFileSync(
    path.join(dest, "package.json"),
    JSON.stringify({
      dependencies: { [PACKAGE_NAME]: "0.6.2" },
      devDependencies: { [PACKAGE_NAME]: "^0.6.2" },
    }),
  );
  mergePackageJson(dest, stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }));
  const out = readPkg(dest);
  expect(out.dependencies).toBeUndefined();
  expect(out.devDependencies[PACKAGE_NAME]).toBe("^0.6.2");
});

it("placeDevDependency is a no-op when src is not repo", () => {
  const destPkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {
    dependencies: { lodash: "4" },
  };
  placeDevDependency(destPkg, { name: "fixture-pkg", version: "1.0.0" });
  expect(destPkg.dependencies).toStrictEqual({ lodash: "4" });
  expect(destPkg.devDependencies?.[PACKAGE_NAME]).toBeUndefined();
});

it.each([
  ["an array", []],
  ["a numeric name", { name: 1 }],
  ["a numeric version", { version: 1 }],
  ["a script that is not a string", { scripts: { a: 1 } }],
  ["scripts as an array", { scripts: [] }],
  ["dependencies as a string", { dependencies: "x" }],
])("package.json refused for %s", (_name, pkg) => {
  const dest = tmp("pj-wrong-");
  const file = path.join(dest, "package.json");
  fs.writeFileSync(file, JSON.stringify(pkg));
  expect(() => mergePackageJson(dest, stubPkgRoot())).toThrowError(`${file} does not hold`);
});
