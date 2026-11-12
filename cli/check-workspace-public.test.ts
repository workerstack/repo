import { describe, expect, it } from "vitest";

import { LOCK_OK, MANIFEST, ROOT, lines } from "./__fixtures__/check-workspace-lines.ts";
import type { PackageJson } from "./sync/workspace.ts";

function sdk(rest: Partial<PackageJson>, root: Partial<PackageJson> = ROOT) {
  return {
    [MANIFEST]: root,
    "packages/core/package.json": { name: "@acme/core" },
    "packages/open/package.json": { name: "@acme/open", private: false },
    "packages/sdk/package.json": { name: "@acme/sdk", private: false, ...rest },
  };
}

function edge(file: string, [name, field, where]: [string, string, string]) {
  return (
    `${file}: "${name}" in ${field} is private in this workspace; a consumer cannot install it, ` +
    `so publish it with "private": false or move the code into ${where}`
  );
}

describe("checkWorkspace public edges", () => {
  it("names a private member in each runtime field of a public member, one line each", () => {
    const files = sdk({
      dependencies: { "@acme/core": "workspace:*" },
      optionalDependencies: { "@acme/core": "workspace:*" },
      peerDependencies: { "@acme/core": "workspace:*" },
    });

    expect(lines(files, LOCK_OK)).toStrictEqual([
      edge("packages/sdk/package.json", ["@acme/core", "dependencies", "packages/sdk"]),
      edge("packages/sdk/package.json", ["@acme/core", "peerDependencies", "packages/sdk"]),
      edge("packages/sdk/package.json", ["@acme/core", "optionalDependencies", "packages/sdk"]),
    ]);
  });

  it("treats a member without private as private", () => {
    const files = {
      ...sdk({ dependencies: { "@acme/nameless": "workspace:*" } }),
      "packages/nameless/package.json": { name: "@acme/nameless" },
    };

    expect(lines(files, LOCK_OK)).toStrictEqual([
      edge("packages/sdk/package.json", ["@acme/nameless", "dependencies", "packages/sdk"]),
    ]);
  });
});

describe("checkWorkspace public root edges", () => {
  it("names a private member a public root depends on", () => {
    const root = { ...ROOT, dependencies: { "@acme/core": "workspace:*" }, name: "@acme/root", private: false };
    expect(lines(sdk({}, root), LOCK_OK)).toStrictEqual([
      'package.json: a workspace root has no "dependencies"; move "@acme/core" into the package that uses it',
      edge("package.json", ["@acme/core", "dependencies", "the root package"]),
    ]);
  });
});

describe("checkWorkspace public edges that pass", () => {
  it("passes devDependencies, a public member and a private package's own edges", () => {
    const files = {
      ...sdk({ dependencies: { "@acme/open": "workspace:*" }, devDependencies: { "@acme/core": "workspace:*" } }),
      "packages/core/package.json": { dependencies: { "@acme/open": "workspace:*" }, name: "@acme/core" },
    };

    expect(lines(files, LOCK_OK)).toStrictEqual([]);
  });
});
