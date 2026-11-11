import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { readPkg, stubPkgRoot, tmp, useInitKit } from "./fixtures/init-kit.ts";
import { mergePackageJson } from "./init.ts";
import { PACKAGE_NAME } from "./sync/stock.ts";

useInitKit();

it("writes the postinstall and the devDependency, and no repo: script or helper dependency", () => {
  const dest = tmp("pj-new-");
  mergePackageJson(dest, stubPkgRoot({ name: PACKAGE_NAME, scripts: { alpha: "a" }, version: "0.7.0" }));
  expect(readPkg(dest)).toEqual({
    devDependencies: { [PACKAGE_NAME]: "0.7.0" },
    packageManager: `bun@${Bun.version}`,
    private: true,
    scripts: { postinstall: "repo sync --postinstall" },
    sideEffects: false,
  });
});

it("writes private, sideEffects and packageManager on the root only when they are absent", () => {
  const dest = tmp("pj-keys-");
  fs.writeFileSync(
    path.join(dest, "package.json"),
    JSON.stringify({ name: "app", packageManager: "bun@^1.4", private: false, sideEffects: ["*.css"] }),
  );
  mergePackageJson(dest, stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }));
  const out = readPkg(dest);
  expect(out).toMatchObject({ packageManager: "bun@^1.4", private: false, sideEffects: ["*.css"] });
});

it("leaves sideEffects off a root that has workspaces", () => {
  const dest = tmp("pj-keys-mono-");
  fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ name: "mono", workspaces: ["packages/*"] }));
  mergePackageJson(dest, stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }));
  const out = readPkg(dest);
  expect(out).toMatchObject({ packageManager: `bun@${Bun.version}`, private: true });
  expect(out).not.toHaveProperty("sideEffects");
});

it("fills only the keys that are missing", () => {
  const dest = tmp("pj-keys-some-");
  fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ name: "app", private: false }));
  mergePackageJson(dest, stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }));
  expect(readPkg(dest)).toMatchObject({
    packageManager: `bun@${Bun.version}`,
    private: false,
    sideEffects: false,
  });
});

it("adds no rulesync, smol-toml or @clack/prompts, even when the package lists them", () => {
  const dest = tmp("pj-nodeps-");
  mergePackageJson(
    dest,
    stubPkgRoot({
      dependencies: { "@clack/prompts": "1", "smol-toml": "^1.8.0" },
      devDependencies: { rulesync: "latest" },
      name: PACKAGE_NAME,
      version: "0.7.0",
    }),
  );
  expect(Object.keys(readPkg(dest).devDependencies)).toEqual([PACKAGE_NAME]);
});

it("keeps the repo's own scripts and dependencies, sorted", () => {
  const dest = tmp("pj-exist-");
  fs.writeFileSync(
    path.join(dest, "package.json"),
    JSON.stringify({
      devDependencies: { lodash: "4", rulesync: "9" },
      name: "app",
      scripts: { claude: "bun run build && claude", foo: "bar", test: "jest" },
    }),
  );
  mergePackageJson(dest, stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }));
  const out = readPkg(dest);
  expect(out.scripts).toEqual({
    claude: "bun run build && claude",
    foo: "bar",
    postinstall: "repo sync --postinstall",
    test: "jest",
  });
  expect(Object.keys(out.scripts)).toEqual(["claude", "foo", "postinstall", "test"]);
  expect(out.devDependencies).toEqual({ [PACKAGE_NAME]: "0.7.0", lodash: "4", rulesync: "9" });
  expect(Object.keys(out.devDependencies)).toEqual([PACKAGE_NAME, "lodash", "rulesync"]);
});

it("removes repo: scripts still equal to a value an older init wrote, and keeps edited ones", () => {
  const dest = tmp("pj-old-");
  fs.writeFileSync(
    path.join(dest, "package.json"),
    JSON.stringify({
      name: "app",
      scripts: {
        doctor: "bun ./.rulesync/scripts/doctor.ts",
        "repo:clean": "repo clean",
        "repo:doctor": "bun ./.rulesync/scripts/doctor.ts",
        "repo:mine": "echo mine",
        "repo:rulesync:generate": "bun ./.rulesync/scripts/guarded-roots.ts generate && bun run build",
        "repo:setup": "repo setup && echo done",
        "repo:sync:globals:apply": "node .rulesync/scripts/sync-global-settings.mjs --apply",
      },
    }),
  );
  mergePackageJson(dest, stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }));
  expect(readPkg(dest).scripts).toEqual({
    doctor: "bun ./.rulesync/scripts/doctor.ts",
    postinstall: "repo sync --postinstall",
    "repo:mine": "echo mine",
    "repo:rulesync:generate": "bun ./.rulesync/scripts/guarded-roots.ts generate && bun run build",
    "repo:setup": "repo setup && echo done",
  });
});
